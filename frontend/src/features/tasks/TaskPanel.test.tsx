import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ListViewPage } from './ListViewPage'
import { TaskPanelRoute } from './TaskPanelRoute'

const base = {
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  title: 'Draft launch post',
  statusId: 'st1',
  priority: 'NORMAL',
  tags: [],
  assigneeIds: [],
  version: 3,
  dueDate: null,
  startDate: null,
  description: null,
}

const statuses = {
  statuses: [
    { id: 'st1', name: 'To do', color: '#94a3b8', group: 'NOT_STARTED' },
    { id: 'st2', name: 'In progress', color: '#3b82f6', group: 'ACTIVE' },
    { id: 'st3', name: 'Done', color: '#22c55e', group: 'DONE' },
  ],
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function serve(initial: Record<string, unknown> = {}, extra: Record<string, never> = {}) {
  const task = { ...base, ...initial }
  const stub = installFetch({
    'GET /api/v1/tasks/:id': () => json(task),
    'GET /api/v1/tasks': () => json({ items: [task] }),
    'GET /api/v1/locations/:id': json({
      id: 'l1',
      name: 'Launch',
      type: 'LIST',
      workspaceId: 'w1',
    }),
    'GET /api/v1/locations/:id/statuses': json(statuses),
    'GET /api/v1/workspaces/:id/members': {
      items: [
        { userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' },
        { userId: 'u2', displayName: 'Omar Haddad', role: 'MEMBER' },
      ],
    },
    'PATCH /api/v1/tasks/:id': (_request, body) => {
      Object.assign(task, body, { version: (task.version as number) + 1 })
      return json(task)
    },
    ...extra,
  })
  return { stub, task }
}

function renderPanel(route = '/t/t1', state?: object) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/w/:workspaceId/l/:locationId" element={<ListViewPage />} />
        <Route path="/t/:taskId" element={<TaskPanelRoute />} />
      </Routes>
      <Where />
    </>,
    { route, state },
  )
}

const patches = (stub: ReturnType<typeof serve>['stub']) =>
  stub.calls.filter((c) => c.method === 'PATCH')

describe('TaskPanel', () => {
  it('FR-16: opened directly, /t/<id> shows every field over the List view of the task', async () => {
    serve({ tags: ['launch'], assigneeIds: ['u1'] })
    renderPanel()

    const panel = await screen.findByRole('complementary', { name: 'Task ACME-1' })
    expect(within(panel).getByLabelText('Title')).toHaveValue('Draft launch post')
    await waitFor(() => expect(within(panel).getByLabelText('Status')).toHaveDisplayValue('To do'))
    expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue('Normal')
    expect(within(panel).getByLabelText('Start date')).toBeVisible()
    expect(within(panel).getByLabelText('Due date')).toBeVisible()
    expect(within(panel).getByText('launch')).toBeVisible()
    expect(await within(panel).findByRole('checkbox', { name: 'Maya Lopez' })).toBeChecked()
    expect(within(panel).getByRole('textbox', { name: 'Description' })).toBeVisible()
    // the List view of the task's home List is behind the panel
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeVisible()
    await waitFor(() => expect(within(panel).getByLabelText('Title')).toHaveFocus())
  })

  it('FR-16: Escape closes the panel and returns focus to the task row', async () => {
    serve()
    const user = userEvent.setup()
    renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } })

    await screen.findByRole('complementary', { name: 'Task ACME-1' })
    await screen.findByRole('link', { name: 'Draft launch post' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/l1'))
    expect(screen.queryByRole('complementary', { name: 'Task ACME-1' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Draft launch post' })).toHaveFocus(),
    )
  })

  it('FR-16: a row clicked behind an open panel keeps the List as background, so Escape returns to the List', async () => {
    serve()
    const user = userEvent.setup()
    renderPanel('/t/t0', { backgroundLocation: { pathname: '/w/w1/l/l1' } })

    await screen.findByRole('complementary', { name: 'Task ACME-1' })
    await user.click(await screen.findByRole('link', { name: 'Draft launch post' }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/l1'))
  })

  it('FR-16: a task that does not exist shows "Task not found."', async () => {
    serve({}, { 'GET /api/v1/tasks/:id': problem(404, 'task.not_found', 'No such task') } as never)
    renderPanel('/t/nope')

    expect(await screen.findByText('Task not found.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
  })

  it('FR-17: saving the title sends If-Match and updates the panel and the row', async () => {
    const { stub } = serve()
    const user = userEvent.setup()
    renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } })

    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Ship the launch post{Enter}')

    expect(await screen.findByText('Saved')).toBeVisible()
    const patch = patches(stub)[0]
    expect(patch.headers.get('If-Match')).toBe('"3"')
    expect(patch.body).toEqual({ title: 'Ship the launch post' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ship the launch post' })).toBeVisible(),
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Ship the launch post')
  })

  it('FR-17: an empty title is restored and not sent', async () => {
    const { stub } = serve()
    const user = userEvent.setup()
    renderPanel()

    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.keyboard('{Enter}')

    expect(title).toHaveValue('Draft launch post')
    expect(patches(stub)).toHaveLength(0)
  })

  it('FR-17: status choices come from the task List and a pick is saved by id', async () => {
    const { stub } = serve()
    const user = userEvent.setup()
    renderPanel()

    const select = await screen.findByLabelText('Status')
    await within(select).findByRole('option', { name: 'In progress' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['To do', 'In progress', 'Done'])
    await user.selectOptions(select, 'In progress')

    await screen.findByText('Saved')
    expect(patches(stub)[0].body).toEqual({ statusId: 'st2' })
    expect(select).toHaveDisplayValue('In progress')
  })

  it('FR-17: a refused edit restores the saved value and shows the server message', async () => {
    serve({}, {
      'PATCH /api/v1/tasks/:id': problem(
        400,
        'task.invalid_dates',
        'dates must start before they end',
      ),
    } as never)
    const user = userEvent.setup()
    renderPanel()

    const due = await screen.findByLabelText('Due date')
    await user.type(due, '2025-03-04')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save the due date: dates must start before they end",
    )
    expect(due).toHaveValue('')
  })

  it('FR-17: a due date is sent as UTC midnight and shows the same calendar day', async () => {
    const { stub } = serve()
    const user = userEvent.setup()
    renderPanel()

    const due = await screen.findByLabelText('Due date')
    await user.type(due, '2025-03-04')

    await screen.findByText('Saved')
    expect(patches(stub)[0].body).toEqual({ dueDate: '2025-03-04T00:00:00Z' })
    expect(due).toHaveValue('2025-03-04')
  })

  it('FR-17: tags and assignees save as lists', async () => {
    const { stub } = serve({ tags: ['a'] })
    const user = userEvent.setup()
    renderPanel()

    const tags = await screen.findByLabelText('Tags')
    await user.type(tags, 'b{Enter}')
    await waitFor(() => expect(patches(stub)).toHaveLength(1))
    expect(patches(stub)[0].body).toEqual({ tags: ['a', 'b'] })

    await user.click(await screen.findByRole('checkbox', { name: 'Omar Haddad' }))
    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].body).toEqual({ assigneeIds: ['u2'] })
    expect(patches(stub)[1].headers.get('If-Match')).toBe('"4"') // version moved on after the first save
  })

  it('FR-18: a 409 shows the banner and the server values, and Apply again resends with the new version', async () => {
    let calls = 0
    const { stub } = serve({}, {
      'PATCH /api/v1/tasks/:id': () => {
        calls += 1
        if (calls === 1) {
          return problem(409, 'task.version_conflict', 'changed', {
            current: { ...base, title: "Maya's new title", version: 7 },
            version: 7,
          })
        }
        return json({
          ...base,
          title: "Maya's new title",
          dueDate: '2025-12-03T00:00:00Z',
          version: 8,
        })
      },
    } as never)
    const user = userEvent.setup()
    renderPanel()

    await user.type(await screen.findByLabelText('Due date'), '2025-12-03')

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Someone else changed this task. Their version is shown.')
    expect(banner).toHaveTextContent('Your change: Dec 3, 2025')
    expect(screen.getByLabelText('Title')).toHaveValue("Maya's new title")
    expect(screen.getByLabelText('Due date')).toHaveValue('')
    // never retried automatically
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(patches(stub)).toHaveLength(1)

    await user.click(within(banner).getByRole('button', { name: 'Apply again' }))

    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].headers.get('If-Match')).toBe('"7"')
    expect(patches(stub)[1].body).toEqual({ dueDate: '2025-12-03T00:00:00Z' })
    await waitFor(() => expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument())
    expect(screen.getByLabelText('Due date')).toHaveValue('2025-12-03')
  })

  it('FR-18: Discard drops the attempted change without sending it', async () => {
    const { stub } = serve({}, {
      'PATCH /api/v1/tasks/:id': problem(409, 'task.version_conflict', 'changed', {
        current: { ...base, version: 9 },
      }),
    } as never)
    const user = userEvent.setup()
    renderPanel()

    const status = await screen.findByLabelText('Status')
    await within(status).findByRole('option', { name: 'Done' })
    await user.selectOptions(status, 'Done')
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Your change: Done')
    await user.click(within(banner).getByRole('button', { name: 'Discard' }))

    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveDisplayValue('To do')
    expect(patches(stub)).toHaveLength(1)
  })
})
