import { QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { ViewQueryResponse } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useOptimisticTaskMutation } from '../tasks'
import { createCachePatcher } from './cachePatcher'

const OWN = 'tab-own'
const task = (version: number, title = 'One') => ({
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  title,
  version,
})

function setup() {
  const queryClient = newQueryClient()
  const key = queryKeys.view('w1', 'l1', 'h')
  queryClient.setQueryData<InfiniteData<ViewQueryResponse>>(key, {
    pages: [{ items: [{ group: 'a', task: task(3) }] }],
    pageParams: [undefined],
  })
  queryClient.setQueryData(queryKeys.task('t1'), task(3))
  const stub = installFetch({ 'GET /api/v1/tasks/:id': () => json(task(5, 'Changed')) })
  const patcher = createCachePatcher(queryClient, { clientId: OWN, debounceMs: 500 })
  const title = () =>
    queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(key)?.pages[0].items?.[0].task?.title
  return { queryClient, stub, patcher, title }
}

const event = (extra = {}) => ({
  type: 'task.updated',
  entity: 'task',
  entityId: 't1',
  version: 5,
  listId: 'l1',
  clientId: 'someone-else',
  ...extra,
})

describe('RT-3 cache patcher', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('ignores an event with the tab’s own client id', async () => {
    const { patcher, stub, title } = setup()
    expect(await patcher.handle('w1', event({ clientId: OWN }))).toBe('own')
    expect(stub.calls).toHaveLength(0)
    expect(title()).toBe('One')
  })

  it('ignores an event at or below the cached version', async () => {
    const { patcher, stub } = setup()
    expect(await patcher.handle('w1', event({ version: 3 }))).toBe('stale')
    expect(await patcher.handle('w1', event({ version: 2 }))).toBe('stale')
    expect(stub.calls).toHaveLength(0)
  })

  it('refetches a newer task, patches every cached page and invalidates the views after 500 ms', async () => {
    const { patcher, stub, title, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(await patcher.handle('w1', event())).toBe('applied')
    expect(stub.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/tasks/t1'])
    expect(title()).toBe('Changed')
    expect(
      invalidate.mock.calls.some(
        ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(queryKeys.viewsAll('w1')),
      ),
    ).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(
      invalidate.mock.calls.some(
        ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(queryKeys.viewsAll('w1')),
      ),
    ).toBe(true)
    patcher.dispose()
  })

  it('holds an event while the user’s own mutation on the task is pending, then applies it', async () => {
    const { patcher, stub, title, queryClient } = setup()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useOptimisticTaskMutation(), { wrapper })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const mutation = result.current({
      task: task(3),
      send: async () => {
        await gate
        return { response: new Response(null, { status: 200 }), data: task(4, 'Mine') as never }
      },
    })
    expect(await patcher.handle('w1', event({ version: 5 }))).toBe('held')
    expect(stub.calls).toHaveLength(0)
    release()
    await act(() => mutation)
    await vi.waitFor(() =>
      expect(stub.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/tasks/t1']),
    )
    await vi.waitFor(() => expect(title()).toBe('Changed'))
    patcher.dispose()
  })

  it('a location event refreshes the tree and the view list', async () => {
    const { patcher, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(
      await patcher.handle('w1', { type: 'location.renamed', entity: 'location', entityId: 'f1' }),
    ).toBe('invalidated')
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys).toContain(JSON.stringify(queryKeys.treeAll('w1')))
    patcher.dispose()
  })
})
