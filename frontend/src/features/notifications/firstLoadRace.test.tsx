import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { problem } from '../../test/api'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useMarkAllRead, useSavePreference, useSetRead } from './useNotifications'
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
