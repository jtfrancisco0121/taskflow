import { QueryObserver } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests, setSession } from '../../api/session'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { DependenciesSection } from './DependenciesSection'

const task = {
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  title: 'Ship release',
  version: 3,
  blocked: false,
  blockerCount: 0,
} as TaskView

const none = {
  waitingOn: [],
  blocking: [],
  linked: [],
  hiddenCount: { waitingOn: 0, blocking: 0, linked: 0 },
}
const item = (id: string, n: number, extra: object = {}) => ({
  dependencyId: `d${n}`,
  task: {
    id,
    readableId: `ACME-${n}`,
    title: `Task ${n}`,
    statusId: 's',
    listId: 'l2',
    finished: false,
    ...extra,
  },
})
const members = {
  items: [
    { userId: 'u1', displayName: 'Maya', role: 'MEMBER' },
    { userId: 'u9', displayName: 'Guest', role: 'GUEST' },
  ],
}

function serve(list: object, extra: Record<string, never> = {}) {
  return installFetch({
    'GET /api/v1/tasks/:id/dependencies': () => json(list),
    'GET /api/v1/workspaces/:id/members': members,
    ...extra,
  })
}

function render() {
  return renderWithProviders(
    <Routes>
      <Route path="*" element={<DependenciesSection task={task} />} />
    </Routes>,
  )
}

describe('FR-9 Dependencies section', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('shows the empty state with Add', async () => {
    serve(none)
    render()
    expect(await screen.findByText('No dependencies yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add a relationship' })).toBeVisible()
  })

  it('shows a loading skeleton, then the groups in order with unfinished first', async () => {
    serve({
      ...none,
      waitingOn: [item('b2', 2, { finished: true }), item('b3', 3)],
      blocking: [item('b4', 4)],
      linked: [item('b5', 5)],
    })
    render()
    expect(screen.getByRole('region', { name: 'Dependencies' })).toHaveAttribute('aria-label')
    const waiting = await screen.findByRole('list', { name: 'Waiting on' })
    const rows = within(waiting).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('ACME-3')
    expect(rows[1]).toHaveTextContent('ACME-2')
    expect(screen.getByRole('list', { name: 'Blocking' })).toHaveTextContent('ACME-4')
    expect(screen.getByRole('list', { name: 'Linked' })).toHaveTextContent('ACME-5')
  })

  it('counts relationships the caller cannot see and never names them', async () => {
    serve({
      ...none,
      waitingOn: [item('b3', 3)],
      hiddenCount: { waitingOn: 2, blocking: 0, linked: 0 },
    })
    render()
    expect(await screen.findByText("2 tasks you can't see")).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Waiting on (3)' })).toBeVisible()
  })

  it('shows a busy skeleton while loading', async () => {
    installFetch({
      'GET /api/v1/tasks/:id/dependencies': () => new Promise<Response>(() => {}),
      'GET /api/v1/workspaces/:id/members': members,
    })
    render()
    const region = await screen.findByRole('region', { name: 'Dependencies' })
    expect(region.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('shows an error with Retry', async () => {
    let calls = 0
    installFetch({
      'GET /api/v1/tasks/:id/dependencies': () =>
        calls++ === 0 ? problem(500, 'x', 'boom') : json(none),
      'GET /api/v1/workspaces/:id/members': members,
    })
    const user = userEvent.setup()
    render()
    expect(await screen.findByText("Couldn't load dependencies.")).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No dependencies yet.')).toBeVisible()
  })

  it('removes at once without a confirmation and sends If-Match', async () => {
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () => new Response(null, { status: 204 }),
      'GET /api/v1/tasks/:id': () => json({ ...task, version: 5 }),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(true))
    const del = stub.calls.find((c) => c.method === 'DELETE')!
    expect(del.url.pathname).toBe('/api/v1/tasks/t1/dependencies/d3')
    expect(del.headers.get('If-Match')).toBe('"3"')
  })

  // Two clicks in one act() land before React re-renders, so the second button is still enabled and
  // only the in-flight guard can stop it (user-event skips disabled buttons and would test nothing).
  it('a second removal while one is pending sends no request (ClickUp 14yq6g33592)', async () => {
    let answer: (r: Response) => void = () => {}
    const stub = serve({ ...none, waitingOn: [item('b3', 3), item('b4', 4)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
      'GET /api/v1/tasks/:id': () => json({ ...task, version: 5 }),
    } as never)
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    const first = await screen.findByRole('button', { name: 'Remove relationship with ACME-3' })
    const second = screen.getByRole('button', { name: 'Remove relationship with ACME-4' })
    act(() => {
      first.click()
      second.click()
    })
    const deletes = () => stub.calls.filter((c) => c.method === 'DELETE')
    await waitFor(() => expect(deletes()).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Remove relationship with ACME-4' })).toBeDisabled()
    answer(new Response(null, { status: 204 }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove relationship with ACME-4' }),
      ).not.toBeDisabled(),
    )
    expect(deletes()).toHaveLength(1)
  })

  it('a pick while a removal is pending sends no request (ClickUp 14yq6g33592)', async () => {
    let answer: (r: Response) => void = () => {}
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
      'GET /api/v1/tasks/:id': () => json({ ...task, version: 5 }),
      'GET /api/v1/workspaces/:id/search': () =>
        json({ items: [{ taskId: 'b7', readableId: 'ACME-7', title: 'Fix login' }] }),
      'POST /api/v1/tasks/:id/dependencies': () =>
        json(
          { dependency: { id: 'd', relation: 'WAITING_ON' }, task: { ...task, version: 6 } },
          201,
        ),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Add a relationship' }))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    const option = await screen.findByRole('option', { name: /ACME-7/ })
    await user.click(screen.getByRole('button', { name: 'Remove relationship with ACME-3' }))
    await user.click(option)
    const posts = () => stub.calls.filter((c) => c.method === 'POST')
    expect(posts()).toHaveLength(0)
    answer(new Response(null, { status: 204 }))
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /ACME-7/ })).not.toHaveAttribute('aria-disabled'),
    )
    await user.click(screen.getByRole('option', { name: /ACME-7/ }))
    await waitFor(() => expect(posts()).toHaveLength(1))
  })

  it('a removal while an add is pending sends no request (ClickUp 14yq6g33592)', async () => {
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () => new Response(null, { status: 204 }),
      'GET /api/v1/workspaces/:id/search': () =>
        json({ items: [{ taskId: 'b7', readableId: 'ACME-7', title: 'Fix login' }] }),
      'POST /api/v1/tasks/:id/dependencies': () => new Promise<Response>(() => {}),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Add a relationship' }))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    const option = await screen.findByRole('option', { name: /ACME-7/ })
    const removeButton = screen.getByRole('button', { name: 'Remove relationship with ACME-3' })
    act(() => {
      option.click()
      removeButton.click()
    })
    await waitFor(() => expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(stub.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })

  it('closing and reopening the picker keeps a pending add: a new pick sends nothing (ClickUp 14yq6g33592)', async () => {
    const stub = serve(none, {
      'GET /api/v1/workspaces/:id/search': () =>
        json({ items: [{ taskId: 'b7', readableId: 'ACME-7', title: 'Fix login' }] }),
      'POST /api/v1/tasks/:id/dependencies': () => new Promise<Response>(() => {}),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Add a relationship' }))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Add a relationship' }))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('puts a row back with an error toast when the removal fails', async () => {
    serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () => problem(500, 'x', 'Server error'),
    } as never)
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Server error'),
    )
    expect(await screen.findByRole('link', { name: /ACME-3/ })).toBeVisible()
  })

  // ClickUp 14yq6g334u1: lock contention is 503 request.busy; one retry after Retry-After.
  const busy = () =>
    new Response(
      JSON.stringify({
        status: 503,
        code: 'request.busy',
        title: 'x',
        detail: 'The server is busy',
      }),
      { status: 503, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '0' } },
    )

  it('retries a busy removal once and keeps it removed without a toast', async () => {
    let n = 0
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () =>
        ++n === 1 ? busy() : new Response(null, { status: 204 }),
      'GET /api/v1/tasks/:id': () => json({ ...task, version: 5 }),
    } as never)
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() => expect(stub.count('DELETE', /dependencies\/d3$/)).toBe(2))
    await waitFor(() => expect(stub.count('GET', /^\/api\/v1\/tasks\/t1$/)).toBe(1))
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('puts a row back with the busy message when the retry is busy too', async () => {
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': busy,
    } as never)
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
        'These tasks are being changed right now. Try again.',
      ]),
    )
    expect(stub.count('DELETE', /dependencies\/d3$/)).toBe(2)
    expect(await screen.findByRole('link', { name: /ACME-3/ })).toBeVisible()
  })

  it('keeps a removal that succeeded when re-reading the task fails afterwards', async () => {
    let deleted = false
    const stub = serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'GET /api/v1/tasks/:id/dependencies': () =>
        json(deleted ? none : { ...none, waitingOn: [item('b3', 3)] }),
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () => {
        deleted = true
        return new Response(null, { status: 204 })
      },
      'GET /api/v1/tasks/:id': () => problem(500, 'x', 'Server error'),
    } as never)
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() => expect(stub.count('GET', /^\/api\/v1\/tasks\/t1$/)).toBe(1))
    // The panel is read again from the server, which no longer has the relationship.
    await waitFor(() => expect(stub.count('GET', /\/dependencies$/)).toBe(2))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /ACME-3/ })).not.toBeInTheDocument(),
    )
    // Not rolled back, no error toast: the removal is saved.
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([])
  })

  it('after a failed re-read the next removal sends the version the DELETE answered with', async () => {
    const gone = new Set<string>()
    let version = 3
    const stub = serve(none, {
      'GET /api/v1/tasks/:id/dependencies': () =>
        json({
          ...none,
          waitingOn: [item('b3', 3), item('b4', 4)].filter((i) => !gone.has(i.dependencyId)),
        }),
      'DELETE /api/v1/tasks/:id/dependencies/:depId': (request: Request) => {
        gone.add(new URL(request.url).pathname.split('/').pop()!)
        version += 1
        return new Response(null, { status: 204, headers: { ETag: `"${version}"` } })
      },
      'GET /api/v1/tasks/:id': () => problem(500, 'x', 'Server error'),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() => expect(stub.count('GET', /^\/api\/v1\/tasks\/t1$/)).toBe(1))
    await waitFor(() =>
      expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(4),
    )
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-4' }))
    await waitFor(() => expect(stub.count('DELETE', /dependencies/)).toBe(2))
    const deletes = stub.calls.filter((c) => c.method === 'DELETE')
    expect(deletes.map((c) => c.headers.get('If-Match'))).toEqual(['"3"', '"4"'])
  })

  it('after a failed re-read the open task detail is refetched from the server', async () => {
    let detailReads = 0
    serve({ ...none, waitingOn: [item('b3', 3)] }, {
      'DELETE /api/v1/tasks/:id/dependencies/:depId': () =>
        new Response(null, { status: 204, headers: { ETag: '"4"' } }),
      'GET /api/v1/tasks/:id': () => problem(500, 'x', 'Server error'),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    // The task panel's detail query (an observer, so a refresh refetches it).
    const detail = new QueryObserver(queryClient, {
      queryKey: queryKeys.task('t1'),
      queryFn: async () => {
        detailReads += 1
        return detailReads === 1 ? task : { ...task, version: 4, blocked: true }
      },
    })
    const stop = detail.subscribe(() => {})
    await waitFor(() => expect(detail.getCurrentResult().data).toEqual(task))
    await user.click(await screen.findByRole('button', { name: 'Remove relationship with ACME-3' }))
    await waitFor(() => expect(detail.getCurrentResult().data?.blocked).toBe(true))
    expect(detailReads).toBe(2)
    stop()
  })

  it('adds a relationship through the picker: search, pick, POST with If-Match and a key', async () => {
    const stub = serve(none, {
      'GET /api/v1/workspaces/:id/search': () =>
        json({
          items: [
            { taskId: 'b7', readableId: 'ACME-7', title: 'Fix login redirect', listName: 'Eng' },
            { taskId: 't1', readableId: 'ACME-1', title: 'Ship release', listName: 'Rel' },
          ],
        }),
      'POST /api/v1/tasks/:id/dependencies': () =>
        json(
          {
            dependency: { id: 'd7', relation: 'WAITING_ON', otherTaskId: 'b7' },
            task: { ...task, version: 4, blocked: true, blockerCount: 1 },
          },
          201,
        ),
    } as never)
    const user = userEvent.setup()
    const { queryClient } = render()
    queryClient.setQueryData(queryKeys.task('t1'), task)
    await user.click(await screen.findByRole('button', { name: 'Add a relationship' }))
    const input = screen.getByRole('combobox', { name: 'Find a task' })
    expect(screen.getByRole('radio', { name: 'Waiting on' })).toBeChecked()
    expect(screen.getByText('Type at least 2 characters.')).toBeVisible()
    await user.type(input, 'login')
    // the task itself is excluded from the results
    const option = await screen.findByRole('option', { name: /ACME-7/ })
    expect(screen.queryByRole('option', { name: /ACME-1 / })).not.toBeInTheDocument()
    await user.click(option)

    const isAdd = (c: (typeof stub.calls)[number]) =>
      c.method === 'POST' && c.url.pathname.endsWith('/dependencies')
    await waitFor(() => expect(stub.calls.some(isAdd)).toBe(true))
    const post = stub.calls.find(isAdd)!
    expect(post.headers.get('If-Match')).toBe('"3"')
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post.body).toEqual({ otherTaskId: 'b7', relation: 'WAITING_ON' })
    // both tasks' caches are refreshed: the acting task comes from the response
    await waitFor(() =>
      expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(4),
    )
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Add a relationship' })).not.toBeInTheDocument(),
    )
  })

  describe('as a guest', () => {
    afterEach(() => resetSessionForTests())

    it('shows the rows read-only: no Add, no Remove', async () => {
      setSession('token', { id: 'me', email: 'g@example.com', displayName: 'Gus' } as never)
      installFetch({
        'GET /api/v1/tasks/:id/dependencies': () => json({ ...none, waitingOn: [item('b3', 3)] }),
        'GET /api/v1/workspaces/:id/members': { items: [{ userId: 'me', role: 'GUEST' }] },
      })
      render()
      expect(await screen.findByRole('link', { name: /ACME-3/ })).toBeVisible()
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Add a relationship' }),
        ).not.toBeInTheDocument(),
      )
      expect(screen.queryByRole('button', { name: /Remove relationship/ })).not.toBeInTheDocument()
    })
  })
})
