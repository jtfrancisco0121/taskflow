import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'

export type ReplaceBody = components['schemas']['ReplaceStatusesRequest']
export type RemapEntry = components['schemas']['RemapRequest']

/** AD-9: any status-set write refreshes every status set and every task list of the Workspace. */
function useRefreshAfterWrite(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesAll(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.taskAll() }),
    ])
}

export function useReplaceStatuses(workspaceId: string, locationId: string) {
  const refresh = useRefreshAfterWrite(workspaceId)
  return useMutation({
    mutationFn: (body: ReplaceBody) =>
      unwrap(
        api.PUT('/api/v1/locations/{id}/statuses', {
          params: { path: { id: locationId } },
          body,
        }),
      ),
    onSuccess: refresh,
  })
}

export function useResetStatuses(workspaceId: string, locationId: string) {
  const refresh = useRefreshAfterWrite(workspaceId)
  return useMutation({
    mutationFn: (remap: RemapEntry[]) =>
      unwrap(
        api.DELETE('/api/v1/locations/{id}/statuses', {
          params: { path: { id: locationId } },
          body: { remap },
        }),
      ),
    onSuccess: refresh,
  })
}
