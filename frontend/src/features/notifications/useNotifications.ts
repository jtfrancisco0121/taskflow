import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

export function useUnreadCount(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.unreadCount(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/notifications/unread-count', {
          params: { path: { id: workspaceId! } },
        }),
      ),
  })
}

export function useInbox(workspaceId: string | undefined, unread: boolean, limit = 20) {
  return useInfiniteQuery({
    queryKey: queryKeys.inbox(workspaceId ?? '', unread),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/notifications', {
          params: { path: { id: workspaceId! }, query: { unread, cursor: pageParam, limit } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** Refreshes the count and every open list of the Workspace. */
export function useRefreshInbox(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    if (!workspaceId) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsAll(workspaceId) })
  }
}

export function useSetRead(workspaceId: string | undefined) {
  const refresh = useRefreshInbox(workspaceId)
  return useMutation({
    mutationFn: (vars: { id: string; read: boolean }) =>
      vars.read
        ? unwrap(api.POST('/api/v1/notifications/{id}/read', { params: { path: { id: vars.id } } }))
        : unwrap(
            api.DELETE('/api/v1/notifications/{id}/read', { params: { path: { id: vars.id } } }),
          ),
    onSettled: refresh,
  })
}

export function useMarkAllRead(workspaceId: string | undefined) {
  const refresh = useRefreshInbox(workspaceId)
  return useMutation({
    mutationFn: (upToId?: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{id}/notifications/read-all', {
          params: { path: { id: workspaceId! } },
          body: { upToId },
        }),
      ),
    onSettled: refresh,
  })
}
