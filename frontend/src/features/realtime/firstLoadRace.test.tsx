import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import { expectRestarted } from '../../test/firstLoadRace'
import { createCachePatcher } from './cachePatcher'

/**
 * A Live event (someone else's write) that arrives while a list's first load is in flight: that load may have been
 * read before the write, so it must be followed by one more read. Live events can come in bursts, so the patcher
 * waits for the first load instead of cancelling it: one extra read per first load, however many events.
 */
const w = 'w1'

function usePatcher() {
  const queryClient = useQueryClient()
  const patcher = useMemo(
    () => createCachePatcher(queryClient, { clientId: 'me', debounceMs: 1 }),
    [queryClient],
  )
  return { patcher, queryClient }
}

const event = (extra: object) => ({ clientId: 'someone-else', entityId: 't1', ...extra }) as never
const comment = event({ type: 'comment.created', entity: 'task' })
const later = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

describe('realtime: a first load in flight when a Live event arrives', () => {
  it('a comment event refreshes the comment list on its first load', async () => {
    await expectRestarted(
      queryKeys.comments('t1'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.handle(w, comment)
      },
    )
  })

  it('a field definition event refreshes the task lists on their first load (cachePatcher :91)', async () => {
    await expectRestarted(
      queryKeys.tasks(w, 'l1'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.handle(w, event({ type: 'custom_field.created', entity: 'location' }))
      },
    )
  })

  it('a task event refreshes the views on their first load after the debounce (cachePatcher :34)', async () => {
    await expectRestarted(
      queryKeys.view(w, 'l1', 'h'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        await patcher.handle(w, event({ type: 'task.updated', entity: 'task', entityId: 't9' }))
        await later() // the debounced invalidation runs while the first load is still held
        wrote()
      },
    )
  })

  it('a location event refreshes the sidebar tree on its first load', async () => {
    await expectRestarted(
      queryKeys.tree(w, 'root'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.handle(w, event({ type: 'location.created', entity: 'location' }))
      },
    )
  })

  it('a reconnect refreshes the views on their first load (LiveUpdates :95)', async () => {
    await expectRestarted(
      queryKeys.view(w, 'l1', 'h'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.reconnected(w)
      },
    )
  })

  it('a reconnect refreshes the sidebar tree on its first load (LiveUpdates :96)', async () => {
    await expectRestarted(
      queryKeys.tree(w, 'root'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.reconnected(w)
      },
    )
  })

  it('a burst of events during one first load ends with one extra read, not one per event', async () => {
    await expectRestarted(
      queryKeys.comments('t1'),
      () => ({}),
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        for (let i = 0; i < 5; i += 1) await patcher.handle(w, comment)
      },
    ) // expectRestarted checks exactly 2 reads: the stale first one and one refetch
  })

  it('an event then a user write that restarts the first load ends on the written data in 2 reads', async () => {
    await expectRestarted(
      queryKeys.comments('t1'),
      () => ({}),
      usePatcher,
      async ({ patcher, queryClient }, wrote) => {
        wrote()
        await patcher.handle(w, comment)
        await cancelThenInvalidate(queryClient, { queryKey: queryKeys.comments('t1') })
      },
    ) // the cancelled first load and the user's restart; the event's wait ends with the cancel
  })
})
