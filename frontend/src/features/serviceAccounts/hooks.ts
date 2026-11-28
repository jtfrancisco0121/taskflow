import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../api/client'
import { ApiError, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'

/** Every service account of the Workspace (an admin has few, so all pages are fetched). */
export function useServiceAccounts(workspaceId: string) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.serviceAccounts(workspaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/service-accounts', {
          params: { path: { workspaceId }, query: { cursor: pageParam, limit: 200 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const accounts = query.data?.pages.flatMap((page) => page.items ?? []) ?? []
  return { ...query, accounts }
}

export function useServiceAccount(workspaceId: string, id: string) {
  return useQuery({
    queryKey: queryKeys.serviceAccount(workspaceId, id),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/service-accounts/{id}', {
          params: { path: { workspaceId, id } },
        }),
      ),
  })
}

export function useApiKeys(workspaceId: string, id: string) {
  return useQuery({
    queryKey: queryKeys.apiKeys(workspaceId, id),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/api-keys', {
          params: { path: { workspaceId, id } },
        }),
      ),
  })
}

export function useAudit(workspaceId: string, id: string) {
  return useQuery({
    queryKey: queryKeys.saAudit(workspaceId, id),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/audit', {
          params: { path: { workspaceId, id } },
        }),
      ),
  })
}

export function useAccountActivity(workspaceId: string, id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.saActivity(workspaceId, id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/activity', {
          params: { path: { workspaceId, id }, query: { cursor: pageParam, limit: 20 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/**
 * Admin actions are rare, so nothing is optimistic: every success refetches the account queries, a first load in
 * flight included (it read before the write).
 */
function useRefresh(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    cancelThenInvalidate(queryClient, { queryKey: queryKeys.serviceAccountsAll(workspaceId) })
}

export function useCreateServiceAccount(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/service-accounts', {
          params: { path: { workspaceId } },
          body: { name },
        }),
      ),
    onSuccess: refresh,
  })
}

export function useSetEnabled(workspaceId: string, id: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(
        enabled
          ? api.POST('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/enable', {
              params: { path: { workspaceId, id } },
            })
          : api.POST('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/disable', {
              params: { path: { workspaceId, id } },
            }),
      ),
    onSuccess: refresh,
  })
}

/**
 * The secret is only in this mutation's result. It is never put in the query cache, and
 * `reset()` drops it when the one-time dialog closes.
 */
export function useCreateApiKey(workspaceId: string, id: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    // No observers left means the result (the secret) leaves the mutation cache at once.
    gcTime: 0,
    mutationFn: (body: { name: string; expiresAt?: string }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/api-keys', {
          params: { path: { workspaceId, id } },
          body,
        }),
      ),
    onSuccess: refresh,
  })
}

/** Revokes one key (the same DELETE the Revoke button sends); usable outside a component. */
export function revokeApiKey(workspaceId: string, id: string, keyId: string) {
  return unwrap(
    api.DELETE('/api/v1/workspaces/{workspaceId}/service-accounts/{id}/api-keys/{keyId}', {
      params: { path: { workspaceId, id, keyId } },
    }),
  )
}

export function useRevokeApiKey(workspaceId: string, id: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (keyId: string) => revokeApiKey(workspaceId, id, keyId),
    onSuccess: refresh,
  })
}

/** Restores a trashed task with the version the trash event recorded (If-Match). */
export function useRestoreTask(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { taskId: string; version: number }) =>
      unwrap(
        api.POST('/api/v1/tasks/{id}/restore', {
          params: { path: { id: vars.taskId }, header: { 'If-Match': `"${vars.version}"` } },
        }),
      ),
    // One round: the account queries and the task lists and views refetch together.
    onSuccess: () =>
      cancelThenInvalidate(
        queryClient,
        { queryKey: queryKeys.serviceAccountsAll(workspaceId) },
        { queryKey: queryKeys.tasksAll(workspaceId) },
        { queryKey: queryKeys.viewsAll(workspaceId) },
      ),
  })
}

export function allPages<T extends { items?: unknown[] }>(
  data: InfiniteData<T> | undefined,
): NonNullable<T['items']> {
  return (data?.pages.flatMap((page) => page.items ?? []) ?? []) as NonNullable<T['items']>
}

/** True for a problem with this HTTP status. */
export function isStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status
}
