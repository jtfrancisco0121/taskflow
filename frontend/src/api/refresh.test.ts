import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { newQueryClient } from '../test/api'
import {
  cancelThenInvalidate,
  restartFirstLoads,
  restartQueries,
  setDataRestartingFetches,
} from './refresh'

describe('restartFirstLoads', () => {
  it('leaves a loaded query alone (no extra request)', async () => {
    const queryClient = newQueryClient()
    const queryFn = vi.fn(async () => 'x')
    await queryClient.fetchQuery({ queryKey: ['ws', 'w1', 'view'], queryFn })
    await restartFirstLoads(queryClient, { queryKey: ['ws', 'w1', 'view'] })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(['ws', 'w1', 'view'])?.isInvalidated).toBe(false)
  })

  it('does not cancel or restart the background refetch of a loaded query', async () => {
    const queryClient = newQueryClient()
    const key = ['ws', 'w1', 'view']
    let reads = 0
    let aborted = false
    const queryFn = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      reads += 1
      signal.addEventListener('abort', () => (aborted = true))
      if (reads > 1) await new Promise((resolve) => setTimeout(resolve, 20))
      return 'x'
    })
    const stop = new QueryObserver(queryClient, { queryKey: key, queryFn }).subscribe(() => {})
    await vi.waitFor(() => expect(queryClient.getQueryData(key)).toBe('x'))
    const refetching = queryClient.refetchQueries({ queryKey: key }) // data present, fetch in flight
    await restartFirstLoads(queryClient, { queryKey: key })
    await refetching
    expect(aborted).toBe(false)
    expect(queryFn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not refetch a query that failed (no data, not fetching)', async () => {
    const queryClient = newQueryClient()
    const key = ['ws', 'w1', 'view']
    const queryFn = vi.fn(async () => {
      throw new Error('boom')
    })
    const stop = new QueryObserver(queryClient, { queryKey: key, queryFn }).subscribe(() => {})
    await vi.waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe('error'))
    await restartFirstLoads(queryClient, { queryKey: key })
    expect(queryFn).toHaveBeenCalledTimes(1)
    stop()
  })

  it('ignores a query of another key still loading', async () => {
    const queryClient = newQueryClient()
    const queryFn = vi.fn(() => new Promise<string>(() => {}))
    void queryClient.prefetchQuery({ queryKey: ['other'], queryFn })
    await restartFirstLoads(queryClient, { queryKey: ['ws', 'w1', 'view'] })
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})

describe('cancelThenInvalidate', () => {
  it('refetches a first load that has no data yet', async () => {
    const queryClient = newQueryClient()
    let reads = 0
    const queryFn = vi.fn(async () => {
      reads += 1
      if (reads === 1) await new Promise(() => {})
      return 'fresh'
    })
    const stop = new QueryObserver(queryClient, { queryKey: ['a'], queryFn }).subscribe(() => {})
    await cancelThenInvalidate(queryClient, { queryKey: ['a'] })
    expect(queryFn).toHaveBeenCalledTimes(2)
    stop()
  })
})

describe('setDataRestartingFetches (14yq6g334bn)', () => {
  it('a background refetch of loaded data in flight at the write does not overwrite it, and is read again', async () => {
    const queryClient = newQueryClient()
    const key = ['task', 't1']
    const answers: Array<(v: string) => void> = []
    const queryFn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve) => {
          answers.push(resolve)
          signal.addEventListener('abort', () => undefined)
        }),
    )
    queryClient.setQueryData(key, 'old')
    const stop = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {})
    void queryClient.refetchQueries({ queryKey: key }) // left before the write
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    setDataRestartingFetches(queryClient, key, () => 'saved')
    answers[0]('old') // the stale answer lands after the write
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    expect(queryClient.getQueryData(key)).toBe('saved')
    answers[1]('saved')
    await vi.waitFor(() => expect(queryClient.getQueryState(key)?.fetchStatus).toBe('idle'))
    expect(queryClient.getQueryData(key)).toBe('saved')
    stop()
  })

  it('sends no extra read when nothing is in flight', async () => {
    const queryClient = newQueryClient()
    const key = ['task', 't1']
    const queryFn = vi.fn(async () => 'server')
    queryClient.setQueryData(key, 'old')
    const stop = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {})
    setDataRestartingFetches(queryClient, key, () => 'saved')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(queryFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(key)).toBe('saved')
    stop()
  })
})

describe('restartQueries and a Load more (PR #45 review 3)', () => {
  it('does not cancel a Load more in flight: its page is kept and the query is read again after it lands', async () => {
    const queryClient = newQueryClient()
    const key = ['ws', 'w1', 'view', 'l1']
    const calls: Array<{ cursor?: string; aborted: boolean; resolve: (v: unknown) => void }> = []
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey: key,
      queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
        new Promise((resolve) => {
          const call = { cursor: pageParam, aborted: false, resolve }
          signal.addEventListener('abort', () => (call.aborted = true))
          calls.push(call)
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { next?: string }) => last.next,
      staleTime: Infinity,
      retry: false,
    } as never)
    const stop = observer.subscribe(() => {})
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0].resolve({ rows: ['a'], next: 'c2' })
    await vi.waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe('success'))
    void observer.fetchNextPage()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    const hash = queryClient.getQueryCache().find({ queryKey: key })!.queryHash
    void restartQueries(queryClient, new Set([hash]))
    expect(calls[1].aborted).toBe(false)
    calls[1].resolve({ rows: ['b'] })
    // Read again after it lands: page 1 then page 2.
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].cursor).toBeUndefined()
    calls[2].resolve({ rows: ['a'], next: 'c2' })
    await vi.waitFor(() => expect(calls).toHaveLength(4))
    calls[3].resolve({ rows: ['b'] })
    await vi.waitFor(() => expect(queryClient.getQueryState(key)?.fetchStatus).toBe('idle'))
    const data = queryClient.getQueryData<{ pages: unknown[] }>(key)
    expect(data?.pages).toHaveLength(2)
    stop()
  })
})
