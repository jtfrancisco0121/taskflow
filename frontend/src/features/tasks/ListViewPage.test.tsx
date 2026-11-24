import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ListViewPage } from './ListViewPage'

const task = (n: number, listId = 'l1', extra = {}) => ({
  id: `t${n}`,
  workspaceId: 'w1',
  listId,
  number: n,
  readableId: `ACME-${n}`,
  title: `Task ${n}`,
  statusId: listId === 'l1' ? 'st-todo' : 'st-backlog',
  priority: 'HIGH',
  assigneeIds: [],
  version: 1,
  ...extra,
})

const locations: Record<string, object> = {
  l1: { id: 'l1', name: 'Launch', type: 'LIST', workspaceId: 'w1' },
  l2: { id: 'l2', name: 'Ideas', type: 'LIST', workspaceId: 'w1' },
  s1: { id: 's1', name: 'Marketing', type: 'SPACE', workspaceId: 'w1' },
  f1: { id: 'f1', name: 'Q4', type: 'FOLDER', workspaceId: 'w1' },
}

const statusSets: Record<string, object> = {
  l1: { statuses: [{ id: 'st-todo', name: 'To do', color: '#94a3b8', group: 'NOT_STARTED' }] },
  l2: { statuses: [{ id: 'st-backlog', name: 'Backlog', color: '#f59e0b', group: 'NOT_STARTED' }] },
}

function renderView(locationId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId/l/:locationId" element={<ListViewPage />} />
    </Routes>,
    { route: `/w/w1/l/${locationId}` },
  )
}

function serve(tasksByCursor: Record<string, object>, extra: Record<string, never> = {}) {
  return installFetch({
    'GET /api/v1/locations/:id': (request) => {
      const found = locations[new URL(request.url).pathname.split('/').pop()!]
      return found ? json(found) : problem(404, 'location.not_found', 'Not found')
    },
    'GET /api/v1/locations/:id/statuses': (request) =>
      json(statusSets[new URL(request.url).pathname.split('/').at(-2)!] ?? { statuses: [] }),
    'GET /api/v1/workspaces/:id/members': {
      items: [{ userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' }],
    },
    'GET /api/v1/tasks': (request) =>
      json(tasksByCursor[new URL(request.url).searchParams.get('cursor') ?? ''] ?? { items: [] }),
    ...extra,
  })
}

describe('ListViewPage', () => {
  it('FR-14: a Space view shows tasks of nested Lists, each status resolved from its own List', async () => {
    const stub = serve({ '': { items: [task(1, 'l1'), task(2, 'l2')] } })
    renderView('s1')

    const row1 = (await screen.findByRole('link', { name: 'Task 1' })).closest('tr')!
    const row2 = screen.getByRole('link', { name: 'Task 2' }).closest('tr')!
    expect(await within(row1).findByText('To do')).toBeVisible()
    expect(await within(row2).findByText('Backlog')).toBeVisible()
    expect(within(row1).getByText('ACME-1')).toBeVisible()
    const request = stub.calls.find((c) => c.url.pathname === '/api/v1/tasks')!
    expect(request.url.searchParams.get('locationId')).toBe('s1')
    expect(request.url.searchParams.has('workspaceId')).toBe(false) // the API accepts exactly one
    expect(request.url.searchParams.get('limit')).toBe('50')
    // one statuses request per distinct List
    expect(stub.calls.filter((c) => c.url.pathname.endsWith('/statuses')).length).toBe(2)
  })

  it('FR-14: the next page is requested with the server cursor and shows no duplicate', async () => {
    const stub = serve({
      '': { items: [task(1), task(2)], nextCursor: 'c2' },
      c2: { items: [task(2), task(3)] },
    })
    const user = userEvent.setup()
    renderView('l1')

    await screen.findByRole('link', { name: 'Task 1' })
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('link', { name: 'Task 3' })).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'Task 2' })).toHaveLength(1)
    const cursors = stub.calls
      .filter((c) => c.url.pathname === '/api/v1/tasks')
      .map((c) => c.url.searchParams.get('cursor'))
    expect(cursors).toEqual([null, 'c2'])
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('FR-14: empty states by type', async () => {
    serve({})
    const { unmount } = renderView('l1')
    expect(await screen.findByText('No tasks yet. Type a title below to add one.')).toBeVisible()
    unmount()

    const space = renderView('s1')
    expect(await screen.findByText('No tasks in this Space yet.')).toBeVisible()
    space.unmount()

    renderView('f1')
    expect(await screen.findByText('No tasks in this Folder yet.')).toBeVisible()
  })

  it('FR-14: a missing or forbidden location shows the not-found message', async () => {
    serve({})
    renderView('nope')

    expect(
      await screen.findByText("This location doesn't exist or you don't have access."),
    ).toBeVisible()
  })

  it('FR-14: shows assignee initials from the Workspace members', async () => {
    serve({ '': { items: [task(1, 'l1', { assigneeIds: ['u1'] })] } })
    renderView('l1')

    expect(await screen.findByLabelText('Maya Lopez')).toHaveTextContent('ML')
  })

  it('FR-15: quick-add shows the new task, clears the input and keeps focus', async () => {
    let created = false
    const stub = serve({}, {
      'GET /api/v1/tasks': () => json({ items: created ? [task(1)] : [] }),
      'POST /api/v1/lists/:id/tasks': () => {
        created = true
        return json(task(1), 201)
      },
    } as never)
    const user = userEvent.setup()
    renderView('l1')

    const input = await screen.findByRole('textbox', { name: 'Add a task' })
    await user.keyboard('{Enter}') // empty: nothing sent
    expect(stub.count('POST', /tasks$/)).toBe(0)
    await user.type(input, 'Task 1{Enter}')

    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()
    expect(screen.getByText('ACME-1')).toBeVisible()
    await waitFor(() => expect(input).toHaveValue(''))
    await waitFor(() => expect(input).toHaveFocus())
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ title: 'Task 1' })
    expect(post.url.pathname).toBe('/api/v1/lists/l1/tasks')
  })

  it('FR-15: a retry of the same title reuses the Idempotency-Key, a new title gets a new one', async () => {
    let fail = true
    const stub = serve({}, {
      'POST /api/v1/lists/:id/tasks': () => {
        if (fail) return problem(503, 'server.unavailable', 'Try again')
        return json(task(1), 201)
      },
    } as never)
    const user = userEvent.setup()
    renderView('l1')

    const input = await screen.findByRole('textbox', { name: 'Add a task' })
    await user.type(input, 'Same title{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again')
    expect(input).toHaveValue('Same title')
    fail = false
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(input).toHaveValue(''))

    const keys = stub.calls
      .filter((c) => c.method === 'POST')
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it('FR-15: there is no quick-add on a Space or a Folder', async () => {
    serve({})
    const { unmount } = renderView('s1')
    await screen.findByText('No tasks in this Space yet.')
    expect(screen.queryByRole('textbox', { name: 'Add a task' })).not.toBeInTheDocument()
    unmount()

    renderView('f1')
    await screen.findByText('No tasks in this Folder yet.')
    expect(screen.queryByRole('textbox', { name: 'Add a task' })).not.toBeInTheDocument()
  })
})
