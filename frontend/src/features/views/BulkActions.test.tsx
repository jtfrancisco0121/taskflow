import { QueryObserver } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { runLimited } from './bulk'
import { ListRenderer } from './ListRenderer'
import { Toaster } from '../../shared/ui/Toaster'
import { baseRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'
import { pick } from '../../test/ui'

const rows = () => Array.from({ length: 50 }, (_, i) => task(i + 1))

function serve(tasks: ReturnType<typeof task>[], extra: Record<string, unknown> = {}) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () =>
      json({
        items: tasks.map((t) => ({ group: 'to do', task: t })),
        groups: [{ key: 'to do', label: 'To do', count: tasks.length }],
      }),
    ...extra,
  } as never)
}

describe('LIST-1 Bulk actions', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [] })
    useToastStore.setState({ toasts: [] })
  })

  it('runLimited never has more than 6 in flight and keeps every result in order', async () => {
    let inFlight = 0
    let peak = 0
    const results = await runLimited(
      Array.from({ length: 50 }, (_, i) => i),
      async (n) => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 2))
        inFlight--
        return n * 2
      },
      6,
    )
    expect(peak).toBe(6)
    expect(results.map((r) => r.result)).toEqual(Array.from({ length: 50 }, (_, i) => i * 2))
  })

  it('LIST-1: 50 tasks, at most 6 requests at once, failures named by readable id', async () => {
    let inFlight = 0
    let peak = 0
    const stub = serve(rows(), {
      'PATCH /api/v1/tasks/:id': async (request: Request, body: unknown) => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 3))
        inFlight--
        const id = new URL(request.url).pathname.split('/').pop()!
        if (id === 't3') return problem(500, 'server.error', 'Boom')
        if (id === 't9') {
          return problem(409, 'task.version_conflict', 'changed', {
            current: task(9, { version: 7 }),
          })
        }
        return json({ ...task(Number(id.slice(1)), { version: 2 }), ...(body as object) })
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await screen.findByRole('link', { name: 'Task 1' })
    useViewStore.setState({ selected: Array.from({ length: 50 }, (_, i) => `t${i + 1}`) })

    await pick(user, await screen.findByLabelText('Set priority'), 'High')

    // 50 PATCHes through the optimistic path: allow for a loaded machine (the suite runs in parallel).
    await waitFor(() => expect(stub.calls.filter((c) => c.method === 'PATCH')).toHaveLength(50), {
      timeout: 8000,
    })
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
    await waitFor(() => {
      const messages = useToastStore.getState().toasts.map((t) => t.message)
      const summary = messages.find((m) => m.startsWith('Priority: 48 of 50'))
      expect(summary).toContain('ACME-3 (could not be saved)')
      expect(summary).toContain('ACME-9 (changed by someone else)')
    })
    // per-task toasts are off during a fan-out: one summary only
    expect(useToastStore.getState().toasts).toHaveLength(1)
  }, 20_000)

  it('LIST-1: the refresh after a fan-out restarts a view still on its first load', async () => {
    // The write lands but its response is lost: the per-task path restores and skips its restart, so the
    // fan-out's own refresh is what must catch a view whose first read came before the write.
    let written = false
    serve([task(1)], {
      'PATCH /api/v1/tasks/:id': () => {
        written = true
        throw new TypeError('network')
      },
    })
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      <ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />,
    )
    await screen.findByRole('link', { name: 'Task 1' })
    let reads = 0
    let release: () => void = () => {}
    const opened = new Promise<void>((resolve) => (release = resolve))
    const probe = new QueryObserver(queryClient, {
      queryKey: queryKeys.view('w1', 'other', 'h'),
      queryFn: async () => {
        reads += 1
        const seen = written
        if (reads === 1) await opened
        return seen ? 'after' : 'before'
      },
    })
    const stop = probe.subscribe(() => {})
    await waitFor(() => expect(reads).toBe(1))
    useViewStore.setState({ selected: ['t1'] })
    await pick(user, await screen.findByLabelText('Set priority'), 'High')
    await waitFor(() =>
      expect(
        useToastStore
          .getState()
          .toasts.map((t) => t.message)
          .join(),
      ).toContain('Priority: 0 of 1 updated'),
    )
    release()
    await waitFor(() => expect(probe.getCurrentResult().data).toBe('after'))
    expect(reads).toBe(2)
    stop()
  })

  it('LIST-1: the refresh after a fan-out does not cancel the restart a saved item started', async () => {
    let written = false
    serve([task(1)], {
      'PATCH /api/v1/tasks/:id': () => {
        written = true
        return json({ ...task(1, { version: 2 }), priority: 'HIGH' })
      },
    })
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      <ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />,
    )
    await screen.findByRole('link', { name: 'Task 1' })
    let reads = 0
    const probe = new QueryObserver(queryClient, {
      queryKey: queryKeys.view('w1', 'other', 'h'),
      queryFn: async () => {
        reads += 1
        const seen = written
        await new Promise(() => {}) // the first read and the item's restart stay in flight
        return seen
      },
    })
    const stop = probe.subscribe(() => {})
    await waitFor(() => expect(reads).toBe(1))
    useViewStore.setState({ selected: ['t1'] })
    await pick(user, await screen.findByLabelText('Set priority'), 'High')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Priority: 1 updated.',
      ),
    )
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2))
    await new Promise((resolve) => setTimeout(resolve, 50)) // a late extra read must fail
    expect(reads).toBe(2) // the stale first read plus the item's restart; the bulk refresh adds none
    stop()
  })

  it('LIST-1: Delete removes the selected tasks and Undo restores them with the new version', async () => {
    const stub = serve([task(1), task(2), task(3)], {
      'DELETE /api/v1/tasks/:id': new Response(null, { status: 204 }),
      'POST /api/v1/tasks/:id/restore': (request: Request) =>
        json(task(Number(new URL(request.url).pathname.split('/').at(-2)!.slice(1)))),
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />
        <Toaster />
      </>,
    )
    await screen.findByRole('link', { name: 'Task 1' })
    useViewStore.setState({ selected: ['t1', 't2', 't3'] })

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Moved 3 tasks to trash.')).toBeVisible()
    expect(
      stub.calls.filter((c) => c.method === 'DELETE').map((c) => c.headers.get('If-Match')),
    ).toEqual(['"1"', '"1"', '"1"'])

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.url.pathname.endsWith('/restore'))).toHaveLength(3),
    )
    // the restore carries the version the delete produced
    expect(
      stub.calls
        .filter((c) => c.url.pathname.endsWith('/restore'))
        .map((c) => c.headers.get('If-Match')),
    ).toEqual(['"2"', '"2"', '"2"'])
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Restored 3 tasks.'),
    )
  })
  it('14yq6g334tg M2: a bulk change of 5 regrouping saves reads the List view at most twice', async () => {
    const five = Array.from({ length: 5 }, (_, i) => task(i + 1))
    const stub = serve(five, {
      'PATCH /api/v1/tasks/:id': async (request: Request, body: unknown) => {
        await new Promise((r) => setTimeout(r, 5))
        const id = new URL(request.url).pathname.split('/').pop()!
        return json({ ...task(Number(id.slice(1)), { version: 2 }), ...(body as object) })
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await screen.findByRole('link', { name: 'Task 1' })
    await act(() => new Promise((r) => setTimeout(r, 150)))
    const before = stub.count('POST', /\/views\/query$/)
    useViewStore.setState({ selected: five.map((t) => t.id) })

    await pick(user, await screen.findByLabelText('Set priority'), 'High')
    await waitFor(() => expect(stub.count('PATCH', /\/tasks\//)).toBe(5))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Priority: 5 updated.',
      ),
    )
    await act(() => new Promise((r) => setTimeout(r, 300)))

    // One List view query (N + 1 with no columns): the coalesced regroup refresh plus the fan-out's own refresh.
    const reads = stub.count('POST', /\/views\/query$/) - before
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(2)
  })
})
