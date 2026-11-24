import type { QueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { cachedVersion, taskMutationGate, writeTaskToCaches } from '../tasks'
import type { LiveEvent } from './stompClient'

export type PatchResult = 'own' | 'stale' | 'held' | 'applied' | 'invalidated'

/**
 * RT-3, AD-15: applies one Live message to the caches. Own client id or a version at or below the
 * cached one cause nothing; otherwise the task is refetched and patched in every cached view page,
 * and the Workspace's view queries are invalidated (debounced 500 ms) because membership may have
 * changed. While the user's own mutation on that task is pending the event is held (AD-20).
 */
export function createCachePatcher(
  queryClient: QueryClient,
  options: { clientId: string; debounceMs?: number; announce?: (message: string) => void },
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const debounceMs = options.debounceMs ?? 500

  function invalidateViewsSoon(workspaceId: string) {
    clearTimeout(timers.get(workspaceId))
    timers.set(
      workspaceId,
      setTimeout(() => {
        timers.delete(workspaceId)
        void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(workspaceId) })
      }, debounceMs),
    )
  }

  async function handle(workspaceId: string, event: LiveEvent): Promise<PatchResult> {
    if (event.clientId && event.clientId === options.clientId) return 'own'
    if (event.entity === 'location') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.treeAll(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.viewListAll(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: ['location'] })
      invalidateViewsSoon(workspaceId)
      options.announce?.('The workspace structure changed.')
      return 'invalidated'
    }
    if (event.entity !== 'task') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      return 'invalidated'
    }
    const cached = cachedVersion(queryClient, workspaceId, event.entityId)
    if (cached != null && event.version != null && event.version <= cached) return 'stale'
    if (taskMutationGate.isPending(event.entityId)) {
      taskMutationGate.whenSettled(event.entityId, () => void handle(workspaceId, event))
      return 'held'
    }
    invalidateViewsSoon(workspaceId)
    if (cached == null) return 'invalidated'
    const { data } = await api.GET('/api/v1/tasks/{id}', {
      params: { path: { id: event.entityId } },
    })
    if (data) {
      writeTaskToCaches(queryClient, data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(event.entityId) })
      options.announce?.(`${data.readableId ?? 'A task'} was updated.`)
    }
    return 'applied'
  }

  return {
    handle,
    dispose() {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    },
  }
}
