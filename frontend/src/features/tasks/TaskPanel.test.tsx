import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { useTaskOrder } from '../../shared/task-order'
import { useUiStore } from '../../shared/ui-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { LocationViewRoute, ViewBackground } from '../views'
import { TaskPanelRoute } from './TaskPanelRoute'
import { expectValue, findOption, findTaskDetail, pick, queryTaskDetail } from '../../test/ui'

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

const noDependencies = {
  waitingOn: [],
  blocking: [],
  linked: [],
  hiddenCount: { waitingOn: 0, blocking: 0, linked: 0 },
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function serve(initial: Record<string, unknown> = {}, extra: Record<string, never> = {}) {
  const task = { ...base, ...initial }
  const stub = installFetch({
    'GET /api/v1/tasks/:id': () => json(task),
    'GET /api/v1/tasks/:id/dependencies': () => json(noDependencies),
    'GET /api/v1/tasks/:id/checklists': () => json([]),
    'GET /api/v1/tasks': () => json({ items: [task] }),
    'GET /api/v1/locations/:id/views': {
      items: [
        { defaultKind: 'LIST', name: 'List', type: 'LIST', config: { v: 1 } },
        { defaultKind: 'BOARD', name: 'Board', type: 'BOARD', config: { v: 1, group: 'status' } },
      ],
    },
    'POST /api/v1/views/query': () => json({ items: [{ group: 'x', task }] }),
    'GET /api/v1/locations/:id': json({
      id: 'l1',
      name: 'Launch',
      type: 'LIST',
      workspaceId: 'w1',
    }),
    'GET /api/v1/locations/:id/statuses': json(statuses),
    'GET /api/v1/locations/:id/fields': json({ locationId: 'l1', canEdit: true, fields: [] }),
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

function renderPanel(
  route = '/t/t1',
  state?: object,
  tabs?: React.ComponentProps<typeof TaskPanelRoute>['tabs'],
) {
  return renderWithProviders(
    <>
      <Routes>
        <Route
          path="/t/:taskId"
          element={
            <TaskPanelRoute
              tabs={tabs}
              background={(location) => <ViewBackground location={location} />}
            />
          }
        />
        <Route path="/w/:workspaceId/l/:locationId" element={<LocationViewRoute />} />
      </Routes>
      <Where />
    </>,
    { route, state },
  )
}

/** The open task detail (modal by default). */
const findOpenPanel = () => queryTaskDetail('Task ACME-1') as HTMLElement

const patches = (stub: ReturnType<typeof serve>['stub']) =>
  stub.calls.filter((c) => c.method === 'PATCH')

/** Opens a date field's Picker and types a day into its footer field. */
async function pickDay(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  day: string,
) {
  await user.click(trigger)
  const input = await screen.findByLabelText(/ day$/)
  fireEvent.change(input, { target: { value: day } })
}

describe('TaskPanel', () => {
  it('FR-16: opened directly, /t/<id> shows every field over the List view of the task', async () => {
    serve({ tags: ['launch'], assigneeIds: ['u1'] })
    renderPanel()

    const panel = await findTaskDetail('Task ACME-1')
    expect(within(panel).getByLabelText('Title')).toHaveValue('Draft launch post')
    await waitFor(() => expectValue(within(panel).getByLabelText('Status'), 'To do'))
    expectValue(within(panel).getByLabelText('Priority'), 'Normal')
    expect(within(panel).getByLabelText('Start date')).toBeVisible()
    expect(within(panel).getByLabelText('Due date')).toBeVisible()
    expect(within(panel).getByText('launch')).toBeVisible()
    expect(
      await within(within(panel).getByLabelText('Assignees')).findByRole('img', {
        name: 'Maya Lopez',
      }),
    ).toBeVisible()
    expect(within(panel).getByRole('textbox', { name: 'Description' })).toBeVisible()
    // the List view of the task's home List is behind the panel
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeVisible()
    await waitFor(() => expect(within(panel).getByLabelText('Title')).toHaveFocus())
  })

  it('FR-16: Escape closes the panel and returns focus to the task row', async () => {
    serve()
    const user = userEvent.setup()
    renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } })

    await findTaskDetail('Task ACME-1')
    await screen.findByRole('link', { name: 'Draft launch post' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/l1'))
    expect(queryTaskDetail('Task ACME-1')).not.toBeInTheDocument()
    // focus goes back to the row of the task last shown
    await waitFor(() => expect(document.querySelector('[data-task-id="t1"]')).toHaveFocus())
  })

  it('FR-16: a row clicked behind an open panel keeps the List as background, so Escape returns to the List', async () => {
    serve()
    const user = userEvent.setup()
    renderPanel('/t/t0', { backgroundLocation: { pathname: '/w/w1/l/l1' } })

    await findTaskDetail('Task ACME-1')
    await user.click(await screen.findByRole('link', { name: 'Draft launch post' }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/l1'))
  })

  it('FR-16: a task that does not exist says it is gone, with a Close button', async () => {
    serve({}, { 'GET /api/v1/tasks/:id': problem(404, 'task.not_found', 'No such task') } as never)
    renderPanel('/t/nope')

    expect(await screen.findByText('This task is gone or you can’t see it.')).toBeVisible()
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
    await findOption(user, select, 'In progress')
    for (const name of ['To do', 'In progress', 'Done']) await findOption(user, select, name)
    await pick(user, select, 'In progress')

    await screen.findByText('Saved')
    expect(patches(stub)[0].body).toEqual({ statusId: 'st2' })
    expectValue(select, 'In progress')
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
    await pickDay(user, due, '2025-03-04')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save the due date: dates must start before they end",
    )
    expectValue(due, '—')
  })

  it('FR-17: a due date is sent as UTC midnight and shows the same calendar day', async () => {
    const { stub } = serve()
    const user = userEvent.setup()
    renderPanel()

    const due = await screen.findByLabelText('Due date')
    await pickDay(user, due, '2025-03-04')

    await screen.findByText('Saved')
    expect(patches(stub)[0].body).toEqual({ dueDate: '2025-03-04T00:00:00Z' })
    expectValue(due, 'Mar 4, 2025')
  })

  it('FR-17: the quick days of a date field are Today, Tomorrow, Next week and No date', async () => {
    const { stub } = serve({ dueDate: '2025-03-04T00:00:00Z' })
    const user = userEvent.setup()
    renderPanel()

    const due = await screen.findByLabelText('Due date')
    for (const name of ['Today', 'Tomorrow', 'Next week', 'No date']) {
      await findOption(user, due, name)
    }
    await pick(user, due, 'Tomorrow')
    await screen.findByText('Saved')
    expect(patches(stub)[0].body).toEqual({
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/),
    })
    await pick(user, due, 'No date')
    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].body).toEqual({ dueDate: null })
  })

  it('FR-17: tags and assignees save as lists', async () => {
    const { stub } = serve({ tags: ['a'] })
    const user = userEvent.setup()
    renderPanel()

    const tags = await screen.findByLabelText('Tags')
    await user.type(tags, 'b{Enter}')
    await waitFor(() => expect(patches(stub)).toHaveLength(1))
    expect(patches(stub)[0].body).toEqual({ tags: ['a', 'b'] })

    await pick(user, await screen.findByLabelText('Assignees'), 'Omar Haddad')
    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].body).toEqual({ assigneeIds: ['u2'] })
    expect(patches(stub)[1].headers.get('If-Match')).toBe('"4"') // version moved on after the first save
  })

  it('FR-17: a second assignee picked after the first save keeps the first', async () => {
    const { stub } = serve({})
    const user = userEvent.setup()
    renderPanel()

    const field = await screen.findByLabelText('Assignees')
    await pick(user, field, 'Omar Haddad')
    await screen.findByText('Saved')
    await pick(user, await screen.findByLabelText('Assignees'), 'Maya Lopez')
    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].body).toEqual({ assigneeIds: ['u2', 'u1'] })
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

    await pickDay(user, await screen.findByLabelText('Due date'), '2025-12-03')

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Someone else changed this task. Their version is shown.')
    expect(banner).toHaveTextContent('Your change: Dec 3, 2025')
    expect(screen.getByLabelText('Title')).toHaveValue("Maya's new title")
    expectValue(screen.getByLabelText('Due date'), '—')
    // never retried automatically
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(patches(stub)).toHaveLength(1)

    await user.click(within(banner).getByRole('button', { name: 'Apply again' }))

    await waitFor(() => expect(patches(stub)).toHaveLength(2))
    expect(patches(stub)[1].headers.get('If-Match')).toBe('"7"')
    expect(patches(stub)[1].body).toEqual({ dueDate: '2025-12-03T00:00:00Z' })
    await waitFor(() => expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument())
    expectValue(screen.getByLabelText('Due date'), 'Dec 3, 2025')
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
    await findOption(user, status, 'Done')
    await pick(user, status, 'Done')
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Your change: Done')
    await user.click(within(banner).getByRole('button', { name: 'Discard' }))

    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument()
    expectValue(screen.getByLabelText('Status'), 'To do')
    expect(patches(stub)).toHaveLength(1)
  })

  describe('custom fields (FIELD-1, 3A S3)', () => {
    const points = {
      id: 'f-points',
      name: 'Story points',
      type: 'NUMBER',
      config: { decimals: 0 },
      options: [],
      definedAt: 's1',
      definedAtName: 'Engineering',
      inherited: true,
      hidden: false,
      version: 1,
    }
    const fieldsRoute = (fields: object[]) => ({
      'GET /api/v1/locations/:id/fields': json({ locationId: 'l1', canEdit: true, fields }),
    })

    it('shows each field with where it comes from and saves an edit with If-Match, keeping it after a reload', async () => {
      const { stub, task } = serve({ customFields: {} }, {
        ...fieldsRoute([points]),
        'PATCH /api/v1/tasks/:id': (_request: Request, body: unknown) => {
          const patch = body as { customFields: Record<string, unknown> }
          Object.assign(task, {
            customFields: {
              ...((task as { customFields?: object }).customFields ?? {}),
              ...patch.customFields,
            },
            version: (task.version as number) + 1,
          })
          return json(task)
        },
      } as never)
      const user = userEvent.setup()
      renderPanel()

      const panel = await findTaskDetail('Task ACME-1')
      expect(await within(panel).findByText('from Engineering')).toBeVisible()
      const box = within(panel).getByRole('textbox', { name: 'Story points for ACME-1' })
      await user.type(box, '5{Enter}')

      await waitFor(() => expect(patches(stub)).toHaveLength(1))
      expect(patches(stub)[0].body).toEqual({ customFields: { 'f-points': 5 } })
      expect(patches(stub)[0].headers.get('If-Match')).toBe('"3"')
      await waitFor(() => expect(box).toHaveValue('5'))
    })

    it('a refused value rolls back and shows the server message', async () => {
      serve({ customFields: { 'f-points': 2 } }, {
        ...fieldsRoute([points]),
        'PATCH /api/v1/tasks/:id': problem(
          400,
          'field.invalid_value',
          'Story points expects a number',
        ),
      } as never)
      const user = userEvent.setup()
      renderPanel()

      const box = await screen.findByRole('textbox', { name: 'Story points for ACME-1' })
      await waitFor(() => expect(box).toHaveValue('2'))
      await user.clear(box)
      await user.type(box, 'abc{Enter}')

      expect(await screen.findByText(/Story points expects a number/)).toBeVisible()
      expect(box).toHaveValue('2')
    })

    it('a 409 shows the banner with the attempted change and the current value', async () => {
      serve({ customFields: { 'f-points': 2 } }, {
        ...fieldsRoute([points]),
        'PATCH /api/v1/tasks/:id': problem(409, 'task.version_conflict', 'changed', {
          current: { ...base, version: 4, customFields: { 'f-points': 9 } },
        }),
      } as never)
      const user = userEvent.setup()
      renderPanel()

      const box = await screen.findByRole('textbox', { name: 'Story points for ACME-1' })
      await waitFor(() => expect(box).toHaveValue('2'))
      await user.clear(box)
      await user.type(box, '7{Enter}')

      expect(await screen.findByText(/Story points: 7/)).toBeVisible()
      await waitFor(() => expect(box).toHaveValue('9'))
    })

    it('shows the empty state when the List has no fields, and an error with Retry', async () => {
      serve({}, fieldsRoute([]) as never)
      renderPanel()
      expect(
        await screen.findByText("No custom fields here. Add one from the location's Fields."),
      ).toBeVisible()
    })

    it('hidden fields are not shown', async () => {
      serve({}, fieldsRoute([{ ...points, hidden: true }]) as never)
      renderPanel()
      await screen.findByText(/No custom fields here/)
      expect(screen.queryByRole('textbox', { name: /Story points/ })).not.toBeInTheDocument()
    })

    it('a failed load of the fields shows an error', async () => {
      serve({}, {
        'GET /api/v1/locations/:id/fields': problem(500, 'internal.error', 'The request failed'),
      } as never)
      renderPanel()
      expect(await screen.findByText(/Couldn't load the custom fields/)).toBeVisible()
    })
  })

  describe('dependencies (DEP, FR-6, FR-9, FR-10)', () => {
    const waiting = {
      waitingOn: [
        {
          dependencyId: 'd1',
          task: { id: 'b1', readableId: 'ACME-87', title: 'Fix login', finished: false },
        },
      ],
      blocking: [],
      linked: [],
      hiddenCount: { waitingOn: 0, blocking: 0, linked: 0 },
    }

    it('FR-10 / FR-9: a blocked task shows the badge with its count and the Dependencies section', async () => {
      serve({ blocked: true, blockerCount: 1 }, {
        'GET /api/v1/tasks/:id/dependencies': () => json(waiting),
      } as never)
      renderPanel()
      const panel = await findTaskDetail('Task ACME-1')
      expect(within(panel).getByRole('img', { name: 'Blocked by 1 task' })).toHaveTextContent(
        'Blocked · 1',
      )
      const section = within(panel).getByRole('region', { name: 'Dependencies' })
      expect(await within(section).findByRole('link', { name: /ACME-87/ })).toBeVisible()
      expect(within(section).getByRole('heading', { name: 'Waiting on (1)' })).toBeVisible()
    })

    it('FR-10: a task that is not blocked has no badge', async () => {
      serve()
      renderPanel()
      const panel = await findTaskDetail('Task ACME-1')
      await within(panel).findByText('No dependencies yet.')
      expect(within(panel).queryByRole('img', { name: /Blocked/ })).not.toBeInTheDocument()
    })

    it('FR-6: completing a blocked task asks first; Cancel sends no request and keeps the status', async () => {
      const { stub } = serve({ blocked: true, blockerCount: 1 }, {
        'GET /api/v1/tasks/:id/dependencies': () => json(waiting),
      } as never)
      const user = userEvent.setup()
      renderPanel()
      const status = await screen.findByLabelText('Status')
      await findOption(user, status, 'Done')

      await pick(user, status, 'Done')
      const dialog = await screen.findByRole('dialog', {
        name: 'Draft launch post is waiting on 1 unfinished task',
      })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(patches(stub)).toHaveLength(0)
      expectValue(screen.getByLabelText('Status'), 'To do')

      // a change that does not complete asks nothing
      await pick(user, screen.getByLabelText('Status'), 'In progress')
      await waitFor(() => expect(patches(stub)).toHaveLength(1))
      expect(screen.queryByRole('dialog', { name: /is waiting on/ })).not.toBeInTheDocument()
    })

    it('FR-6: "Complete anyway" sends the change', async () => {
      const { stub } = serve({ blocked: true, blockerCount: 1 }, {
        'GET /api/v1/tasks/:id/dependencies': () => json(waiting),
      } as never)
      const user = userEvent.setup()
      renderPanel()
      const status = await screen.findByLabelText('Status')
      await findOption(user, status, 'Done')
      await pick(user, status, 'Done')
      await user.click(await screen.findByRole('button', { name: 'Complete anyway' }))
      await waitFor(() => expect(patches(stub)).toHaveLength(1))
      expect(patches(stub)[0].body).toEqual({ statusId: 'st3' })
    })
  })

  describe('frames (AD-1, AD-2)', () => {
    const composer = () => (
      <div>
        <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Composer" />
        <button type="button">Tab button</button>
      </div>
    )

    it('opens a 940px modal dialog named by the task, with an activity column', async () => {
      serve()
      renderPanel('/t/t1', undefined, composer)
      const dialog = await findTaskDetail('Task ACME-1')
      expect(dialog).toHaveAttribute('role', 'dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog.className).toContain('max-w-[940px]')
      const column = within(dialog).getByRole('region', { name: 'Discussion and activity' })
      expect(column.className).toContain('w-[330px]')
      expect(within(column).getByRole('textbox', { name: 'Composer' })).toBeInTheDocument()
    })

    it('the Docked toggle switches to a complementary panel, remembers it and keeps unsaved description text', async () => {
      const { stub } = serve()
      const user = userEvent.setup()
      renderPanel()
      const dialog = await findTaskDetail('Task ACME-1')
      const toggle = within(dialog).getByRole('button', { name: 'Docked' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      const editor = within(dialog).getByRole('textbox', { name: 'Description' })
      await user.click(editor)
      await user.keyboard('Remember me')
      await user.click(toggle)

      const docked = await screen.findByRole('complementary', { name: 'Task ACME-1' })
      expect(docked.className).toContain('w-[600px]')
      expect(screen.queryByRole('dialog', { name: 'Task ACME-1' })).toBeNull()
      expect(within(docked).getByRole('button', { name: 'Docked' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(localStorage.getItem('taskflow:task-detail')).toBe('docked')
      await waitFor(() => expect(patches(stub).length).toBeGreaterThan(0))
      expect(JSON.stringify(patches(stub).at(-1)?.body)).toContain('Remember me')
      // the toggle keeps focus after the switch
      expect(within(docked).getByRole('button', { name: 'Docked' })).toHaveFocus()
    })

    it('switching docked to modal leaves focus on the Docked toggle', async () => {
      localStorage.setItem('taskflow:task-detail', 'docked')
      serve()
      const user = userEvent.setup()
      renderPanel()
      const docked = await screen.findByRole('complementary', { name: 'Task ACME-1' })
      await user.click(within(docked).getByRole('button', { name: 'Docked' }))
      const dialog = await screen.findByRole('dialog', { name: 'Task ACME-1' })
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Docked' })).toHaveFocus(),
      )
    })

    it('opens docked when that was remembered, and an unknown stored value falls back to the modal', async () => {
      localStorage.setItem('taskflow:task-detail', 'docked')
      serve()
      const first = renderPanel()
      expect(await screen.findByRole('complementary', { name: 'Task ACME-1' })).toBeVisible()
      first.unmount()
      useUiStore.setState({ taskDetailMode: null })
      localStorage.setItem('taskflow:task-detail', 'sideways')
      renderPanel()
      expect(await screen.findByRole('dialog', { name: 'Task ACME-1' })).toBeVisible()
    })

    it('with localStorage throwing the toggle still works and nothing is logged', async () => {
      serve()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied')
      })
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied')
      })
      const user = userEvent.setup()
      renderPanel()
      const dialog = await findTaskDetail('Task ACME-1')
      await user.click(within(dialog).getByRole('button', { name: 'Docked' }))
      expect(await screen.findByRole('complementary', { name: 'Task ACME-1' })).toBeVisible()
      expect(error).not.toHaveBeenCalled()
      get.mockRestore()
      set.mockRestore()
      error.mockRestore()
    })

    it.each(['modal', 'docked'] as const)(
      'Escape in the comment composer keeps the %s open and the text; Escape on a button closes it',
      async (mode) => {
        useUiStore.setState({ taskDetailMode: mode })
        serve()
        const user = userEvent.setup()
        renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } }, composer)
        const detail = await findTaskDetail('Task ACME-1')
        const box = within(detail).getByRole('textbox', { name: 'Composer' })
        box.textContent = 'half a comment'
        box.focus()
        fireEvent.keyDown(box, { key: 'Escape' })
        expect(queryTaskDetail('Task ACME-1')).toBeInTheDocument()
        expect(box).toHaveTextContent('half a comment')
        within(detail).getByRole('button', { name: 'Tab button' }).focus()
        await user.keyboard('{Escape}')
        await waitFor(() => expect(queryTaskDetail('Task ACME-1')).toBeNull())
      },
    )

    it('shows a retry for a server error and the gone message for a 404', async () => {
      let calls = 0
      serve({}, {
        'GET /api/v1/tasks/:id': () =>
          ++calls === 1 ? problem(500, 'boom', 'Server broke') : json(base),
      } as never)
      const user = userEvent.setup()
      renderPanel()
      expect(await screen.findByText('Server broke')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await findTaskDetail('Task ACME-1')).toBeVisible()
    })

    // ClickUp 14yq6g334fe: a background refresh that fails keeps the open task, with a non-blocking Retry notice.
    it('a failed background refresh keeps the task on screen with a Retry notice, and Retry clears it', async () => {
      let fail = false
      serve({}, {
        'GET /api/v1/tasks/:id': () => (fail ? problem(500, 'boom', 'Server broke') : json(base)),
      } as never)
      const user = userEvent.setup()
      const { queryClient } = renderPanel()
      expect(within(await findTaskDetail('Task ACME-1')).getByLabelText('Title')).toHaveValue(
        'Draft launch post',
      )

      fail = true
      await act(() => queryClient.refetchQueries({ queryKey: queryKeys.task('t1') }))
      const notice = await screen.findByRole('status', { name: 'Couldn’t refresh' })
      expect(within(findOpenPanel()).getByLabelText('Title')).toHaveValue('Draft launch post')
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

      fail = false
      await user.click(within(notice).getByRole('button', { name: 'Retry' }))
      await waitFor(() =>
        expect(screen.queryByRole('status', { name: 'Couldn’t refresh' })).toBeNull(),
      )
      expect(within(findOpenPanel()).getByLabelText('Title')).toHaveValue('Draft launch post')
    })

    it('a failed first load shows the error screen with Retry, and no refresh notice', async () => {
      serve({}, { 'GET /api/v1/tasks/:id': () => problem(500, 'boom', 'Server broke') } as never)
      renderPanel()
      expect(await screen.findByText('Server broke')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
      expect(screen.queryByRole('status', { name: 'Couldn’t refresh' })).toBeNull()
      expect(screen.queryByLabelText('Title')).toBeNull()
    })

    it('shows a skeleton while the task loads', async () => {
      serve({}, { 'GET /api/v1/tasks/:id': () => new Promise<Response>(() => {}) } as never)
      renderPanel()
      const dialog = await screen.findByRole('dialog', { name: 'Task' })
      expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull()
    })
  })

  describe('j/k between the tasks of the List behind (AD-6)', () => {
    const path = () => screen.getByTestId('where').textContent
    const order = ['t0', 't1', 't2']

    // the List behind shows three tasks and publishes their order, like the real view does
    const listOf = (ids: string[]) => ({
      'GET /api/v1/tasks': () =>
        json({ items: ids.map((id, n) => ({ ...base, id, readableId: `ACME-${n + 1}` })) }),
      'POST /api/v1/views/query': () =>
        json({
          items: ids.map((id, n) => ({
            group: 'x',
            task: { ...base, id, readableId: `ACME-${n + 1}`, title: `Task ${id}` },
          })),
        }),
      'GET /api/v1/tasks/:id': (request: Request) =>
        json({ ...base, id: new URL(request.url).pathname.split('/').at(-1) }),
    })

    async function open() {
      renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } })
      const detail = await findTaskDetail('Task ACME-1')
      await waitFor(() => expect(useTaskOrder.getState().ids).toEqual(order))
      const close = within(detail).getByRole('button', { name: 'Close task panel' })
      close.focus()
      return { detail, close }
    }

    it.each(['modal', 'docked'] as const)(
      'j and k open the next and previous task in the %s frame, stopping at the ends',
      async (mode) => {
        useUiStore.setState({ taskDetailMode: mode })
        serve({}, listOf(order) as never)
        const user = userEvent.setup()
        await open()
        await user.keyboard('j')
        await waitFor(() => expect(path()).toBe('/t/t2'))
        await user.keyboard('j')
        expect(path()).toBe('/t/t2')
        await user.keyboard('{ArrowUp}')
        await waitFor(() => expect(path()).toBe('/t/t1'))
        await user.keyboard('k')
        await waitFor(() => expect(path()).toBe('/t/t0'))
        await user.keyboard('k')
        expect(path()).toBe('/t/t0')
      },
    )

    it('does nothing in a text field, with a Picker open, or when the task is not in the List order', async () => {
      serve({}, listOf(order) as never)
      const user = userEvent.setup()
      const { detail } = await open()
      await user.click(within(detail).getByLabelText('Title'))
      await user.keyboard('j')
      expect(path()).toBe('/t/t1')

      await user.click(within(detail).getByLabelText('Status'))
      await screen.findByRole('option', { name: 'Done' })
      await user.keyboard('j')
      expect(path()).toBe('/t/t1')
      await user.keyboard('{Escape}')
    })

    it('does nothing without a List behind, and under the Complete anyway dialog', async () => {
      useTaskOrder.setState({ ids: [] })
      serve({ blocked: true, blockerCount: 1 }, {
        'GET /api/v1/tasks/:id/dependencies': () =>
          json({
            ...noDependencies,
            waitingOn: [
              { task: { id: 'b1', readableId: 'ACME-2', title: 'Other' }, relation: 'WAITING_ON' },
            ],
          }),
      } as never)
      const user = userEvent.setup()
      renderPanel('/t/t1', { backgroundLocation: { pathname: '/w/w1/l/l1' } })
      const detail = await findTaskDetail('Task ACME-1')
      within(detail).getByRole('button', { name: 'Close task panel' }).focus()
      await user.keyboard('j')
      expect(path()).toBe('/t/t1')

      useTaskOrder.setState({ ids: order })
      await pick(user, within(detail).getByLabelText('Status'), 'Done')
      const dialog = await screen.findByRole('dialog', { name: /is waiting on/ })
      within(dialog).getByRole('button', { name: 'Cancel' }).focus()
      await user.keyboard('j')
      expect(path()).toBe('/t/t1')
    })
  })
})
