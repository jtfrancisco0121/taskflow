import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { toApiError, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import type { ViewConfig, ViewDto } from '../../api/types'
import { DEFAULT_BOARD_ID, DEFAULT_LIST_ID, scopeId, type ViewScope } from './scope'

/** The route id of a view: stored views by id, Default views by their reserved strings. */
export function viewKey(view: ViewDto): string {
  if (view.defaultKind) return view.defaultKind === 'LIST' ? DEFAULT_LIST_ID : DEFAULT_BOARD_ID
  return view.id ?? ''
}

export function useViews(scope: ViewScope) {
  return useQuery({
    queryKey: queryKeys.viewList(scope.workspaceId, scopeId(scope)),
    queryFn: async () => {
      const result = scope.locationId
        ? await unwrap(
            api.GET('/api/v1/locations/{id}/views', { params: { path: { id: scope.locationId } } }),
          )
        : await unwrap(
            api.GET('/api/v1/workspaces/{id}/views', {
              params: { path: { id: scope.workspaceId } },
            }),
          )
      return result.items ?? []
    },
  })
}

export type SaveViewInput =
  | { mode: 'update'; view: ViewDto; config: ViewConfig }
  | {
      mode: 'create'
      name?: string
      type: 'LIST' | 'BOARD' | 'TABLE' | 'CALENDAR'
      visibility?: 'SHARED' | 'PERSONAL' | 'PRIVATE'
      defaultKind?: 'LIST' | 'BOARD'
      shareWith?: string[]
      config: ViewConfig
    }

/** Saving a Default view posts `defaultKind`; the stored row then replaces the virtual one. */
export function useSaveView(scope: ViewScope) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveViewInput): Promise<ViewDto> => {
      if (input.mode === 'update' && input.view.id) {
        return unwrap(
          api.PATCH('/api/v1/views/{id}', {
            params: { path: { id: input.view.id } },
            body: { config: input.config },
          }),
        )
      }
      const body =
        input.mode === 'create'
          ? input
          : {
              type: input.view.defaultKind as 'LIST' | 'BOARD',
              defaultKind: input.view.defaultKind as 'LIST' | 'BOARD',
              config: input.config,
            }
      const result = await api.POST('/api/v1/views', {
        body: {
          ...(scope.locationId
            ? { locationId: scope.locationId }
            : { workspaceId: scope.workspaceId }),
          name: 'name' in body ? body.name : undefined,
          type: body.type,
          visibility: 'visibility' in body ? body.visibility : undefined,
          defaultKind: body.defaultKind,
          shareWith: 'shareWith' in body ? body.shareWith : undefined,
          config: body.config,
        },
      })
      if (!result.response.ok || !result.data) throw toApiError(result.response, result.error)
      return result.data
    },
    onSuccess: () =>
      cancelThenInvalidate(queryClient, {
        queryKey: queryKeys.viewList(scope.workspaceId, scopeId(scope)),
      }),
  })
}

export function useDeleteView(scope: ViewScope) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (view: ViewDto) => {
      if (!view.id) return
      const { response, error } = await api.DELETE('/api/v1/views/{id}', {
        params: { path: { id: view.id } },
      })
      if (!response.ok) throw toApiError(response, error)
    },
    onSuccess: () =>
      cancelThenInvalidate(queryClient, {
        queryKey: queryKeys.viewList(scope.workspaceId, scopeId(scope)),
      }),
  })
}
