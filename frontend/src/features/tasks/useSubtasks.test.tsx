import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { writeTaskToCaches, invalidateSubtaskScans } from './taskCaches'
import { useSubtasks } from './useSubtasks'

const child = (n: number, parent: string, extra = {}) => ({
  id: `c${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  readableId: `ACME-${n}`,
  title: `Child ${n}`,
  parentTaskId: parent,
  statusId: 's1',
  version: 1,
  ...extra,
})
const parent = (id: string): TaskView => ({ id, workspaceId: 'w1', listId: 'l1', number: 99 })

function wrapperFor(queryClient: ReturnType<typeof newQueryClient>) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useSubtasks (AD-5)', () => {
  it('keeps the direct children of the parent, ordered by number, and asks for archived Lists too', async () => {
    const stub = installFetch({
      'GET /api/v1/tasks': json({
        items: [child(5, 'p1'), child(3, 'p1'), child(4, 'p2'), parent('p1')],
      }),
    })
    const { result } = renderHook(() => useSubtasks(parent('p1')), {
      wrapper: wrapperFor(newQueryClient()),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items.map((t) => t.id)).toEqual(['c3', 'c5'])
    expect(result.current.data?.capped).toBe(false)
    const url = stub.calls[0].url
    expect(url.searchParams.get('includeArchived')).toBe('true')
    expect(url.searchParams.get('locationId')).toBe('l1')
    expect(url.searchParams.get('limit')).toBe('200')
  })

  it('stops after 10 pages and says it is capped', async () => {
    let calls = 0
    installFetch({
      'GET /api/v1/tasks': () => json({ items: [child(++calls, 'p1')], nextCursor: `c${calls}` }),
    })
    const { result } = renderHook(() => useSubtasks(parent('p1')), {
      wrapper: wrapperFor(newQueryClient()),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toBe(10)
    expect(result.current.data?.capped).toBe(true)
  })

  it('scans a List once for two parents, and a window focus does not refetch', async () => {
    const stub = installFetch({
      'GET /api/v1/tasks': json({ items: [child(3, 'p1'), child(4, 'p2')] }),
    })
    const queryClient = newQueryClient()
    const first = renderHook(() => useSubtasks(parent('p1')), { wrapper: wrapperFor(queryClient) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    const second = renderHook(() => useSubtasks(parent('p2')), { wrapper: wrapperFor(queryClient) })
    await waitFor(() => expect(second.result.current.data?.items.map((t) => t.id)).toEqual(['c4']))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stub.count('GET', /\/tasks$/)).toBe(1)
  })

  it('a status update written to the caches changes the subtask row without a request', async () => {
    const stub = installFetch({ 'GET /api/v1/tasks': json({ items: [child(3, 'p1')] }) })
    const queryClient = newQueryClient()
    const { result } = renderHook(
      () => {
        const query = useSubtasks(parent('p1'))
        return { ok: query.isSuccess, status: query.data?.items[0]?.statusId }
      },
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current.status).toBe('s1'))
    act(() =>
      writeTaskToCaches(queryClient, child(3, 'p1', { statusId: 's2', version: 2 }) as TaskView),
    )
    await waitFor(() => expect(result.current.status).toBe('s2'))
    expect(stub.count('GET', /\/tasks$/)).toBe(1)
  })

  it('invalidateSubtaskScans refetches one List, or all of them', async () => {
    const stub = installFetch({ 'GET /api/v1/tasks': json({ items: [] }) })
    const queryClient = newQueryClient()
    const { result } = renderHook(() => useSubtasks(parent('p1')), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    invalidateSubtaskScans(queryClient, 'other')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stub.count('GET', /\/tasks$/)).toBe(1)
    invalidateSubtaskScans(queryClient, 'l1')
    await waitFor(() => expect(stub.count('GET', /\/tasks$/)).toBe(2))
    invalidateSubtaskScans(queryClient)
    await waitFor(() => expect(stub.count('GET', /\/tasks$/)).toBe(3))
    expect(queryClient.getQueryState(queryKeys.subtaskScan('l1'))).toBeDefined()
  })
})
