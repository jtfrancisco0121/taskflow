import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, inBackground, invalidateAfterFirstLoads } from '../../api/refresh'
import { useToastStore } from '../../shared/toast-store'

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

/** After a write: refreshes the count and every open list (a first load in flight too), in the background. */
export function useRefreshInbox(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    if (!workspaceId) return
    inBackground(
      cancelThenInvalidate(queryClient, { queryKey: queryKeys.notificationsAll(workspaceId) }),
    )
  }
}

/**
 * The same refresh for Live notification events and reconnects, which come in bursts: a first load in flight is not
 * cancelled per event (a steady stream would keep it loading) but refetched once after it lands.
 */
export function useLiveRefreshInbox(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    if (!workspaceId) return
    void invalidateAfterFirstLoads(queryClient, {
      queryKey: queryKeys.notificationsAll(workspaceId),
    })
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

export type Pref = { kind?: string; inApp?: boolean; emailDigest?: boolean }
type Prefs = { kinds?: Pref[] }

/** Saves one kind's switches (CAP-13). Optimistic: the switch moves at once and goes back when the server refuses. */
export function useSavePreference(workspaceId: string) {
  const queryClient = useQueryClient()
  const toast = useToastStore((s) => s.show)
  const key = queryKeys.notificationPreferences(workspaceId)
  return useMutation({
    mutationFn: (pref: Required<Pref>) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{id}/notification-preferences', {
          params: { path: { id: workspaceId } },
          body: { kinds: [pref] },
        }),
      ),
    onMutate: async (pref) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Prefs>(key)
      // Written unconditionally (no `if (previous)`): the query then always has data, so no later fetch is a first
      // load and the plain onSettled invalidate below restarts it. Guarded by firstLoadRace.test.tsx.
      queryClient.setQueryData<Prefs>(key, {
        kinds: previous?.kinds?.map((k) => (k.kind === pref.kind ? { ...k, ...pref } : k)),
      })
      return { previous }
    },
    onError: (error, _pref, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast(messageOf(error), 'error')
    },
    onSuccess: () => toast('Notification settings saved'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
