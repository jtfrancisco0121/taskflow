import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { TaskPanelRoute } from '../tasks'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { ActivityTab } from './ActivityTab'
import { TaskTabs } from './TaskTabs'

const task: TaskView = { id: 't1', workspaceId: 'w1', listId: 'l1', readableId: 'ACME-1' }
const A = '3f2b8f0e-aaaa-4bbb-8ccc-1234567890ab'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const entry = (id: string, type: string, actor: string, payload: object, extra = {}) => ({
  id,
  type,
  actorName: actor,
  actorType: 'USER',
  payload,
  createdAt: new Date().toISOString(),
  ...extra,
})

function serve(items: object[], extra: Record<string, never> = {}) {
  return installFetch({
    'GET /api/v1/tasks/:id/activity': (request) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      if (cursor === 'c2') return json({ items: [items.at(-1)] })
      return json(items.length > 2 ? { items: items.slice(0, 2), nextCursor: 'c2' } : { items })
    },
    'GET /api/v1/locations/:id/statuses': {
      statuses: [
        { id: 's1', name: 'To do' },
        { id: 's2', name: 'Done' },
      ],
    },
    'GET /api/v1/workspaces/:id/members': {
      items: [
        { userId: 'u1', displayName: 'Maya Lopez' },
        { userId: 'u2', displayName: 'Omar Haddad' },
      ],
    },
    ...extra,
  })
}

describe('ActivityTab', () => {
  it('FR-21: shows actor name, sentence and an Agent badge for a service account', async () => {
    serve([
      entry('a1', 'task.created', 'Maya Lopez', {}),
      entry(
        'a2',
        'comment.created',
        'triage-agent',
        {},
        { actorType: 'SERVICE_ACCOUNT', actorKeyName: 'CI-1' },
      ),
    ])
    renderWithProviders(<ActivityTab task={task} />)

    const created = (await screen.findByText('created this task')).closest('li')!
    expect(within(created).getByText('Maya Lopez')).toBeVisible()
    const bot = screen.getByText('commented').closest('li')!
    expect(within(bot).getByText('triage-agent (key CI-1)')).toBeVisible()
    expect(within(bot).getByText('Agent')).toBeVisible()
    expect(within(created).queryByText('Agent')).not.toBeInTheDocument()
  })

  it('FIELD: an agent setting a custom field reads "<name> (key <key>)" then "set <field> to <value>"', async () => {
    serve([
      entry(
        'a1',
        'task.updated',
        'triage-agent',
        {
          changes: {
            customFields: {
              'f-1': { field: 'Customer tier', fromText: '', toText: 'Enterprise' },
              'f-2': { field: 'Notes', fromText: 'x', toText: '' },
            },
          },
        },
        { actorType: 'SERVICE_ACCOUNT', actorKeyName: 'CI-1' },
      ),
    ])
    renderWithProviders(<ActivityTab task={task} />)

    const item = (await screen.findByText('set Customer tier to Enterprise')).closest('li')!
    expect(within(item).getByText('triage-agent (key CI-1)')).toBeVisible()
    expect(within(item).getByText('Agent')).toBeVisible()
    expect(within(item).getByText('cleared Notes')).toBeVisible()
  })

  it('FR-21: a status change with real UUIDs reads "changed status from To do to Done" with no UUID', async () => {
    serve([
      entry('a1', 'task.status_changed', 'Maya Lopez', {
        changes: { statusId: { from: 's1', to: 's2' } },
      }),
    ])
    const { container } = renderWithProviders(<ActivityTab task={task} />)

    await waitFor(() => expect(screen.getByText('changed status from To do to Done')).toBeVisible())
    expect(container.textContent).not.toMatch(UUID_RE)
  })

  it('FR-21: a from id missing from the set shows "a removed status"', async () => {
    serve([
      entry('a1', 'task.status_changed', 'Maya Lopez', {
        changes: { statusId: { from: A, to: 's2' } },
      }),
    ])
    const { container } = renderWithProviders(<ActivityTab task={task} />)

    expect(await screen.findByText('changed status from a removed status to Done')).toBeVisible()
    expect(container.textContent).not.toContain(A)
  })

  it('FR-21: assignee ids show member names and a task.updated with two fields shows both', async () => {
    serve([
      entry('a1', 'task.updated', 'Maya Lopez', {
        changes: {
          assigneeIds: { from: [], to: ['u2'] },
          title: { from: 'Old', to: 'New' },
        },
      }),
    ])
    renderWithProviders(<ActivityTab task={task} />)

    expect(await screen.findByText('changed assignees from none to Omar Haddad')).toBeVisible()
    expect(screen.getByText('changed title from Old to New')).toBeVisible()
  })

  it('FR-21: Show more requests the next page with the server cursor', async () => {
    const stub = serve([
      entry('a1', 'task.created', 'A', {}),
      entry('a2', 'task.restored', 'B', {}),
      entry('a3', 'task.trashed', 'C', {}),
    ])
    const user = userEvent.setup()
    renderWithProviders(<ActivityTab task={task} />)

    await screen.findByText('restored this task')
    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByText('moved this task to trash')).toBeVisible()
    const cursors = stub.calls
      .filter((c) => c.url.pathname.endsWith('/activity'))
      .map((c) => c.url.searchParams.get('cursor'))
    expect(cursors).toEqual([null, 'c2'])
  })

  it('FR-21: an edit in the panel invalidates and reloads the activity log', async () => {
    const taskBody = {
      id: 't1',
      workspaceId: 'w1',
      listId: 'l1',
      readableId: 'ACME-1',
      title: 'Old',
      version: 1,
      tags: [],
    }
    const stub = serve([entry('a1', 'task.created', 'Maya Lopez', {})], {
      'GET /api/v1/tasks/:id': json(taskBody),
      'GET /api/v1/tasks': { items: [taskBody] },
      'GET /api/v1/locations/:id': { id: 'l1', name: 'Launch', type: 'LIST' },
      'PATCH /api/v1/tasks/:id': json({ ...taskBody, title: 'New', version: 2 }),
      'GET /api/v1/tasks/:id/comments': { items: [] },
    } as never)
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/t/:taskId" element={<TaskPanelRoute tabs={(t) => <TaskTabs task={t} />} />} />
      </Routes>,
      { route: '/t/t1' },
    )

    await user.click(await screen.findByRole('tab', { name: 'Activity' }))
    await screen.findByText('created this task')
    const before = stub.count('GET', /\/activity$/)
    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'New{Enter}')

    await waitFor(() => expect(stub.count('GET', /\/activity$/)).toBeGreaterThan(before))
  })
})
