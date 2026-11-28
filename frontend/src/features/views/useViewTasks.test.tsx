import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { installFetch, json, newQueryClient } from '../../test/api'
import { scope, task } from './testSupport'
import { useViewTasks } from './useViewTasks'

describe('useViewTasks (AD-5, AD-6)', () => {
  it('reads the next page with the server cursor and never sends an offset', async () => {
    const stub = installFetch({
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const cursor = (body as { cursor?: string }).cursor
        return cursor
          ? json({ items: [{ group: 'a', task: task(3) }] })
          : json({
              items: [
                { group: 'a', task: task(1) },
                { group: 'a', task: task(2) },
              ],
              nextCursor: 'cursor-1',
              groups: [{ key: 'a', label: 'A', count: 3 }],
            })
      },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useViewTasks(scope, { v: 1, group: 'status' }), { wrapper })

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasNextPage).toBe(true)
    expect(result.current.groups).toEqual([{ key: 'a', label: 'A', count: 3 }])
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(result.current.hasNextPage).toBe(false)

    const bodies = stub.calls.map((c) => c.body as Record<string, unknown>)
    expect(bodies[0]).toMatchObject({
      scope: { locationId: 'l1' },
      config: { v: 1, group: 'status' },
    })
    expect(bodies[0].cursor).toBeUndefined()
    expect(bodies[1].cursor).toBe('cursor-1')
    for (const b of bodies) {
      expect(Object.keys(b)).not.toContain('offset')
      expect(Object.keys(b)).not.toContain('page')
    }
  })

  it('14yq6g334bn AC7: the Board lead (limit 1) and a List (limit 50) on one scope and config are separate entries', async () => {
    const stub = installFetch({
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { limit } = body as { limit: number }
        const rows = [1, 2, 3].slice(0, limit).map((n) => ({ group: 'a', task: task(n) }))
        return json({ items: rows, groups: [{ key: 'a', label: 'A', count: 3 }] })
      },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const config = { v: 1, group: 'status' }
    const lead = renderHook(() => useViewTasks(scope, config, { limit: 1 }), { wrapper })
    await waitFor(() => expect(lead.result.current.items).toHaveLength(1))
    // The List opens on the same scope and config: it never shows the lead's one row, and reads its own page.
    const seen: number[] = []
    const list = renderHook(
      () => {
        const query = useViewTasks(scope, config)
        if (query.data) seen.push(query.items.length)
        return query
      },
      { wrapper },
    )
    await waitFor(() => expect(list.result.current.items).toHaveLength(3))
    expect(seen).not.toContain(1)
    expect(lead.result.current.items).toHaveLength(1)
    expect(stub.calls.map((c) => (c.body as { limit: number }).limit)).toEqual([1, 50])
    const entries = queryClient.getQueryCache().findAll({ queryKey: ['ws', 'w1', 'view'] })
    expect(entries).toHaveLength(2)
  })

  it('a Board column passes its group value and a Workspace scope sends the workspace id', async () => {
    const stub = installFetch({ 'POST /api/v1/views/query': { items: [] } })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () =>
        useViewTasks({ workspaceId: 'w1' }, { v: 1, group: 'priority' }, { groupValue: 'URGENT' }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(stub.calls[0].body).toMatchObject({ scope: { workspaceId: 'w1' }, groupValue: 'URGENT' })
  })

  it('returns the same items array between renders, so a Table fed with it cannot re-render in a loop', async () => {
    installFetch({
      'POST /api/v1/views/query': { items: [{ group: 'a', task: task(1) }] },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(() => useViewTasks(scope, { v: 1 }), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const first = result.current.items
    rerender()
    expect(result.current.items).toBe(first)
  })
  it('14yq6g334tg M2: a cancelled view query aborts its HTTP request', async () => {
    const signals: AbortSignal[] = []
    installFetch({
      'POST /api/v1/views/query': (request: Request) => {
        signals.push(request.signal)
        return new Promise<Response>(() => undefined)
      },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    renderHook(() => useViewTasks(scope, { v: 1 }), { wrapper })
    await waitFor(() => expect(signals).toHaveLength(1))
    expect(signals[0].aborted).toBe(false)

    await act(() => queryClient.cancelQueries())

    expect(signals[0].aborted).toBe(true)
  })
})
