import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { installFetch, newQueryClient, problem } from '../../test/api'
import { expectRestarted, put } from '../../test/firstLoadRace'
import {
  useLiveRefreshInbox,
  useMarkAllRead,
  useSavePreference,
  useSetRead,
} from './useNotifications'
import { useSetWatching } from './useWatchers'

const w = 'w1'

describe('notifications: an inbox or count on its first load when the write lands (cancel before invalidate)', () => {
  it('useSetRead restarts the unread count, without holding the mutation on the refetch', async () => {
    await expectRestarted(
      queryKeys.unreadCount(w),
      (wrote) => ({ 'POST /api/v1/notifications/:id/read': put(wrote, {}) }),
      () => useSetRead(w),
      (read) => read.mutateAsync({ id: 'n1', read: true }),
      { holdRefetch: true, check: ({ write }) => expect(write.isPending).toBe(false) },
    )
  })

  it('useMarkAllRead restarts the inbox list', async () => {
    await expectRestarted(
      queryKeys.inbox(w, false),
      (wrote) => ({ 'POST /api/v1/workspaces/:id/notifications/read-all': put(wrote, {}) }),
      () => useMarkAllRead(w),
      (all) => all.mutateAsync(undefined),
    )
  })
})

describe('notifications: Live events and reconnects during the count first load', () => {
  it('a burst of events during the first load ends loaded with one extra read', async () => {
    await expectRestarted(
      queryKeys.unreadCount(w),
      () => ({}),
      () => useLiveRefreshInbox(w),
      async (refresh, wrote) => {
        wrote()
        for (let i = 0; i < 5; i += 1) refresh()
      },
    ) // exactly 2 reads: the first load and one refetch after it lands
  })

  it('a steady stream of events does not keep the first load from landing (no starvation)', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    let reads = 0
    const { result } = renderHook(
      () => ({
        count: useQuery({
          queryKey: queryKeys.unreadCount(w),
          queryFn: async () => {
            reads += 1
            await sleep(30) // each read takes 30 ms
            return reads
          },
        }),
        refresh: useLiveRefreshInbox(w),
      }),
      { wrapper },
    )
    for (let i = 0; i < 10; i += 1) {
      act(() => result.current.refresh()) // an event every 10 ms for 100 ms
      await act(() => sleep(10))
    }
    expect(result.current.count.data).toBeDefined()
  })
})

describe('the onMutate window: a first load that starts after the optimistic cancel, before the write lands', () => {
  it('useSetWatching restarts the watchers on settle', async () => {
    await expectRestarted(
      queryKeys.watchers('t1'),
      (wrote) => ({ 'PUT /api/v1/tasks/:id/watch': put(wrote, { watching: true, count: 1 }) }),
      () => useSetWatching('t1'),
      (watch) => watch.mutateAsync(true),
      { startDuringWrite: true },
    )
  })

  it('useSetWatching restarts the watchers when the write fails', async () => {
    await expectRestarted(
      queryKeys.watchers('t1'),
      (wrote) => ({
        'PUT /api/v1/tasks/:id/watch': () => {
          wrote()
          return problem(500, 'internal', 'Failed')
        },
      }),
      () => useSetWatching('t1'),
      (watch) => watch.mutateAsync(true).catch(() => undefined),
      { startDuringWrite: true },
    )
  })

  // Guard: safe only because onMutate always writes data (see useSavePreference). If it stops writing, this fails.
  it('useSavePreference (notification settings) restarts the preferences on settle', async () => {
    await expectRestarted(
      queryKeys.notificationPreferences(w),
      (wrote) => ({ 'PUT /api/v1/workspaces/:id/notification-preferences': put(wrote, {}) }),
      () => useSavePreference(w),
      (save) => save.mutateAsync({ kind: 'ASSIGNED', inApp: false, emailDigest: false }),
      { startDuringWrite: true },
    )
  })
})
