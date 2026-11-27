import { QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { newQueryClient } from '../test/api'
import { cancelThenInvalidate, restartFirstLoads } from './refresh'

describe('restartFirstLoads', () => {
  it('leaves a loaded query alone (no extra request)', async () => {
    const queryClient = newQueryClient()
    const queryFn = vi.fn(async () => 'x')
    await queryClient.fetchQuery({ queryKey: ['ws', 'w1', 'view'], queryFn })
    await restartFirstLoads(queryClient, { queryKey: ['ws', 'w1', 'view'] })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(['ws', 'w1', 'view'])?.isInvalidated).toBe(false)
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
