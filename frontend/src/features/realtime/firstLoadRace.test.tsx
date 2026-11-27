import { type QueryClient, QueryObserver, useQueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import { installFetch, newQueryClient } from '../../test/api'
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

  it('a field definition event refreshes the task lists on their first load', async () => {
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

  it('a task event refreshes the views on their first load after the debounce', async () => {
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

  it('a reconnect refreshes the open views on their first load', async () => {
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

  it('a reconnect refreshes the sidebar tree on its first load', async () => {
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

describe('realtime: a task event while that task detail or its subtask scan is on its first load', () => {
  const taskEvent = event({ type: 'task.updated', entity: 'task', version: 2, listId: 'l1' })
  const routes = () => ({
    'GET /api/v1/tasks/:id': { id: 't1', workspaceId: w, listId: 'l1', version: 2 },
  })

  it('a task in no cache (detail on its first load) is refetched after that load', async () => {
    await expectRestarted(queryKeys.task('t1'), routes, usePatcher, async ({ patcher }, wrote) => {
      wrote()
      await patcher.handle(w, taskEvent)
    })
  })

  it('a task cached in a view: the patched detail is not left to its late first load', async () => {
    await expectRestarted(
      queryKeys.task('t1'),
      routes,
      usePatcher,
      async ({ patcher, queryClient }, wrote) => {
        queryClient.setQueryData(queryKeys.view(w, 'l1', 'h'), {
          pages: [{ items: [{ task: { id: 't1', workspaceId: w, version: 1 } }] }],
          pageParams: [undefined],
        })
        wrote()
        await patcher.handle(w, taskEvent)
      },
    )
  })

  it('a blocker event: the dependent detail patched during its first load is not left to that load', async () => {
    await expectRestarted(
      queryKeys.task('t1'),
      routes,
      usePatcher,
      async ({ patcher, queryClient }, wrote) => {
        queryClient.setQueryData(queryKeys.view(w, 'l1', 'h'), {
          pages: [{ items: [{ task: { id: 't1', workspaceId: w, version: 1 } }] }],
          pageParams: [undefined],
        })
        wrote()
        await patcher.handle(w, event({ type: 'task.blocker_resolved', entity: 'task' }))
      },
    )
  })

  it('a stale event (a view already holds its version) still refetches the detail on its first load', async () => {
    await expectRestarted(
      queryKeys.task('t1'),
      routes,
      usePatcher,
      async ({ patcher, queryClient }, wrote) => {
        queryClient.setQueryData(queryKeys.view(w, 'l1', 'h'), {
          pages: [{ items: [{ task: { id: 't1', workspaceId: w, version: 2 } }] }],
          pageParams: [undefined],
        })
        wrote()
        expect(await patcher.handle(w, taskEvent)).toBe('stale')
      },
    )
  })

  it('an unseen task: the subtask scan of its List on its first load is refetched after that load', async () => {
    await expectRestarted(
      queryKeys.subtaskScan('l1'),
      routes,
      usePatcher,
      async ({ patcher }, wrote) => {
        wrote()
        await patcher.handle(w, taskEvent)
        await later() // the debounced rescan runs while the first load is still held
      },
    )
  })
})

describe('realtime: the debounced views refresh takes its first loads from the events, not the timer', () => {
  /** Observes `key` (an active query, as a mounted view) with a first read held until `release()`. */
  function watch(queryClient: QueryClient, key: readonly unknown[]) {
    let reads = 0
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => {
        reads += 1
        if (reads === 1) await held
        return reads
      },
    })
    const stop = observer.subscribe(() => {})
    return { reads: () => reads, release, stop, data: () => observer.getCurrentResult().data }
  }
  const taskEvent = event({ type: 'task.updated', entity: 'task', entityId: 't9' })
  const debounceMs = 20
  const pastDebounce = () => new Promise<void>((resolve) => setTimeout(resolve, debounceMs * 3))

  it('a view mounted after the event (its first load read after it) gets no extra read', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: 'me', debounceMs })
    await patcher.handle(w, taskEvent)
    const view = watch(queryClient, queryKeys.view(w, 'l1', 'h'))
    await pastDebounce() // the timer fires while that first load is still in flight
    view.release()
    await waitFor(() => expect(view.data()).toBe(1))
    await pastDebounce()
    expect(view.reads()).toBe(1)
    view.stop()
    patcher.dispose()
  })

  it('a comment event does not refetch a subtask scan on its first load', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: 'me', debounceMs })
    const scan = watch(queryClient, queryKeys.subtaskScan('l1'))
    await waitFor(() => expect(scan.reads()).toBe(1))
    await patcher.handle(w, event({ type: 'comment.created', entity: 'task', listId: 'l1' }))
    scan.release()
    await waitFor(() => expect(scan.data()).toBe(1))
    await pastDebounce()
    expect(scan.reads()).toBe(1)
    scan.stop()
    patcher.dispose()
  })

  it('a task event with no listId does not refetch the scans of other Lists', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: 'me', debounceMs })
    const scan = watch(queryClient, queryKeys.subtaskScan('l1'))
    await waitFor(() => expect(scan.reads()).toBe(1))
    await patcher.handle(w, event({ type: 'task.updated', entity: 'task', entityId: 't5' }))
    scan.release()
    await waitFor(() => expect(scan.data()).toBe(1))
    await pastDebounce()
    expect(scan.reads()).toBe(1)
    scan.stop()
    patcher.dispose()
  })

  it('a burst of unseen-task events during a scan first load ends with exactly one extra read', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: 'me', debounceMs })
    const scan = watch(queryClient, queryKeys.subtaskScan('l1'))
    await waitFor(() => expect(scan.reads()).toBe(1))
    for (let i = 0; i < 3; i += 1)
      await patcher.handle(
        w,
        event({ type: 'task.created', entity: 'task', entityId: 't5', listId: 'l1' }),
      )
    scan.release() // the first load lands before the debounced rescan fires
    await waitFor(() => expect(scan.data()).toBe(2))
    await pastDebounce()
    await pastDebounce()
    expect(scan.reads()).toBe(2)
    scan.stop()
    patcher.dispose()
  })

  it('a view on its first load when the event came still gets its one refetch', async () => {
    installFetch({})
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: 'me', debounceMs })
    const view = watch(queryClient, queryKeys.view(w, 'l1', 'h'))
    await waitFor(() => expect(view.reads()).toBe(1))
    await patcher.handle(w, taskEvent)
    await pastDebounce() // still in flight when the timer fires
    view.release()
    await waitFor(() => expect(view.data()).toBe(2))
    await pastDebounce()
    expect(view.reads()).toBe(2)
    view.stop()
    patcher.dispose()
  })
})
