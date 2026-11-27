import type { InvalidateQueryFilters, QueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { firstLoadsOf, invalidateAfterFirstLoads, invalidateAfterLoadsOf } from '../../api/refresh'
import {
  cachedVersion,
  invalidateSubtaskScans,
  taskMutationGate,
  writeTaskToCaches,
} from '../tasks'
import type { LiveEvent } from './stompClient'

export type PatchResult = 'own' | 'stale' | 'held' | 'applied' | 'invalidated'

/**
 * RT-3, AD-15: applies one Live message to the caches. Own client id or a version at or below the
 * cached one cause nothing; otherwise the task is refetched and patched in every cached view page,
 * and the Workspace's view queries are invalidated (debounced 500 ms, at most 2 s behind a steady
 * stream of events) because membership may have
 * changed. While the user's own mutation on that task is pending the event is held (AD-20).
 * Every refresh here also covers a list still on its first load (read before the event): it is
 * refetched once after that load lands, never cancelled, so a burst of events costs one extra read.
 */
export function createCachePatcher(
  queryClient: QueryClient,
  options: {
    clientId: string
    debounceMs?: number
    maxWaitMs?: number
    announce?: (message: string) => void
  },
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Per Workspace, the views on their first load when an event of the pending debounce came (union). */
  const viewFirstLoads = new Map<string, Set<string>>()
  /** Per Workspace, when the first event of the pending views debounce came. */
  const viewsWaitingSince = new Map<string, number>()
  /** Per List, the scans refreshTaskFirstLoads already refetches after their first load (the debounce skips them). */
  const scanFirstLoads = new Map<string, Set<string>>()
  const debounceMs = options.debounceMs ?? 500
  const maxWaitMs = options.maxWaitMs ?? 2000
  let lastFieldsAnnounce = 0

  function invalidateViewsSoon(workspaceId: string) {
    const views = { queryKey: queryKeys.viewsAll(workspaceId) }
    const firstLoads = viewFirstLoads.get(workspaceId) ?? new Set<string>()
    for (const hash of firstLoadsOf(queryClient, views)) firstLoads.add(hash)
    viewFirstLoads.set(workspaceId, firstLoads)
    const now = Date.now()
    const since = viewsWaitingSince.get(workspaceId) ?? now
    viewsWaitingSince.set(workspaceId, since)
    clearTimeout(timers.get(workspaceId))
    timers.set(
      workspaceId,
      setTimeout(
        () => {
          timers.delete(workspaceId)
          viewFirstLoads.delete(workspaceId)
          viewsWaitingSince.delete(workspaceId)
          void invalidateAfterLoadsOf(queryClient, firstLoads, views)
        },
        // Trailing debounce, but a steady stream of events still refreshes once per maxWait.
        Math.max(0, Math.min(debounceMs, since + maxWaitMs - now)),
      ),
    )
  }

  /** A task this tab has never seen changed in a List (a subtask added by someone else): rescan that List once per burst. */
  function invalidateSubtaskScanSoon(listId: string) {
    const key = `subtasks:${listId}`
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        const covered = scanFirstLoads.get(listId)
        scanFirstLoads.delete(listId)
        invalidateSubtaskScans(queryClient, listId, covered)
      }, debounceMs),
    )
  }

  /**
   * The task's detail, and the subtask scans of the event's List, that are on their first load now read
   * before this event (writeTaskToCaches would be overwritten by that load, or finds no scan to patch):
   * each is refetched once after that load lands. Loaded ones are patched or rescanned as before; the
   * debounced rescan skips a scan refetched here.
   */
  function refreshTaskFirstLoads(event: LiveEvent) {
    const filters: InvalidateQueryFilters[] = [
      { queryKey: queryKeys.task(event.entityId), exact: true },
    ]
    if (event.listId) filters.push({ queryKey: queryKeys.subtaskScan(event.listId) })
    const firstLoads = firstLoadsOf(queryClient, ...filters)
    if (event.listId) {
      const covered = scanFirstLoads.get(event.listId) ?? new Set<string>()
      for (const hash of firstLoadsOf(queryClient, filters[1])) covered.add(hash)
      scanFirstLoads.set(event.listId, covered)
    }
    void invalidateAfterLoadsOf(queryClient, firstLoads)
  }

  /**
   * A blocker finished or came back (CAP-6): the dependent's version did not change, so there is no
   * version comparison. The dependent is refetched (its blocked flag), its relationship list and the
   * open views are refreshed, also when this tab caused it: its own write only touched the blocker.
   */
  async function handleBlocker(workspaceId: string, event: LiveEvent): Promise<PatchResult> {
    if (taskMutationGate.isPending(event.entityId)) {
      taskMutationGate.whenSettled(event.entityId, () => void handleBlocker(workspaceId, event))
      return 'held'
    }
    void invalidateAfterFirstLoads(queryClient, {
      queryKey: queryKeys.dependencies(event.entityId),
    })
    invalidateViewsSoon(workspaceId)
    refreshTaskFirstLoads(event)
    if (cachedVersion(queryClient, workspaceId, event.entityId) == null) return 'invalidated'
    const { data } = await api.GET('/api/v1/tasks/{id}', {
      params: { path: { id: event.entityId } },
    })
    if (data) {
      writeTaskToCaches(queryClient, data)
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.activity(event.entityId) })
      options.announce?.(
        data.blocked
          ? `${data.readableId ?? 'A task'} is blocked.`
          : `${data.readableId ?? 'A task'} is no longer blocked.`,
      )
    }
    return 'applied'
  }

  async function handle(workspaceId: string, event: LiveEvent): Promise<PatchResult> {
    const blockerEvent =
      event.type === 'task.blocker_resolved' || event.type === 'task.blocker_reopened'
    if (!blockerEvent && event.clientId && event.clientId === options.clientId) return 'own'
    if (event.entity === 'location' && event.type.startsWith('custom_field.')) {
      // A definition changed (3A, AD-12): refresh the field lists and columns, and everything that
      // shows values, since a renamed Option or a retired field changes how they read.
      void invalidateAfterFirstLoads(queryClient, {
        predicate: (q) => q.queryKey[0] === 'location' && q.queryKey[2] === 'fields',
      })
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.taskAll() })
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.tasksAll(workspaceId) })
      invalidateViewsSoon(workspaceId)
      // One announcement for a burst of definition events (a new field with several Options).
      const now = Date.now()
      if (now - lastFieldsAnnounce > 2000) {
        lastFieldsAnnounce = now
        options.announce?.('Fields changed.')
      }
      return 'invalidated'
    }
    if (event.entity === 'location') {
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.treeAll(workspaceId) })
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.viewListAll(workspaceId) })
      void invalidateAfterFirstLoads(queryClient, { queryKey: ['location'] })
      invalidateViewsSoon(workspaceId)
      options.announce?.('The workspace structure changed.')
      return 'invalidated'
    }
    if (event.entity === 'automation') {
      // A rule changed or ran (3C): refresh the rule lists and their run histories.
      void invalidateAfterFirstLoads(queryClient, {
        predicate: (q) => q.queryKey[0] === 'location' && q.queryKey[2] === 'automations',
      })
      void invalidateAfterFirstLoads(queryClient, { queryKey: ['automation'] })
      return 'invalidated'
    }
    if (event.entity === 'notification') {
      // Per-person events (3C) are handled by the notifications feature, not here.
      return 'invalidated'
    }
    if (event.entity !== 'task') {
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.workspaces() })
      return 'invalidated'
    }
    if (event.type === 'task.blocker_resolved' || event.type === 'task.blocker_reopened') {
      return handleBlocker(workspaceId, event)
    }
    if (event.type === 'task.dependency_added' || event.type === 'task.dependency_removed') {
      // The relationship list of either end changed; the task itself follows the version rules.
      void invalidateAfterFirstLoads(queryClient, {
        queryKey: queryKeys.dependencies(event.entityId),
      })
    }
    const comment = event.type.startsWith('comment.')
    if (comment) {
      // A comment does not change the task's version: refresh its tabs before the version check.
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.comments(event.entityId) })
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.activity(event.entityId) })
    }
    // Before the version check: a view may hold this version while the detail's first load read before it.
    if (!comment) refreshTaskFirstLoads(event)
    const cached = cachedVersion(queryClient, workspaceId, event.entityId)
    if (cached != null && event.version != null && event.version <= cached) return 'stale'
    if (taskMutationGate.isPending(event.entityId)) {
      taskMutationGate.whenSettled(event.entityId, () => void handle(workspaceId, event))
      return 'held'
    }
    invalidateViewsSoon(workspaceId)
    if (cached == null) {
      if (event.listId && !comment) invalidateSubtaskScanSoon(event.listId)
      return 'invalidated'
    }
    const { data } = await api.GET('/api/v1/tasks/{id}', {
      params: { path: { id: event.entityId } },
    })
    if (data) {
      writeTaskToCaches(queryClient, data)
      void invalidateAfterFirstLoads(queryClient, { queryKey: queryKeys.activity(event.entityId) })
      options.announce?.(`${data.readableId ?? 'A task'} was updated.`)
    }
    return 'applied'
  }

  /** After a reconnect the open views and the tree are refetched once (messages may have been missed). */
  function reconnected(workspaceId: string) {
    return invalidateAfterFirstLoads(
      queryClient,
      { queryKey: queryKeys.viewsAll(workspaceId) },
      { queryKey: queryKeys.treeAll(workspaceId) },
    )
  }

  return {
    handle,
    reconnected,
    dispose() {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      viewFirstLoads.clear()
      viewsWaitingSince.clear()
      scanFirstLoads.clear()
    },
  }
}
