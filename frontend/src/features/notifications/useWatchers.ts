import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { WatchView } from '../../api/types'

export function useWatchers(taskId: string) {
  return useQuery({
    queryKey: queryKeys.watchers(taskId),
    retry: false,
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks/{id}/watchers', { params: { path: { id: taskId } } })),
  })
}

/** Watch or unwatch: optimistic, rolled back when the server refuses (CAP-10). */
export function useSetWatching(taskId: string) {
  const queryClient = useQueryClient()
  const key = queryKeys.watchers(taskId)
  return useMutation({
    mutationFn: (watching: boolean) =>
      watching
        ? unwrap(api.PUT('/api/v1/tasks/{id}/watch', { params: { path: { id: taskId } } }))
        : unwrap(api.DELETE('/api/v1/tasks/{id}/watch', { params: { path: { id: taskId } } })),
    onMutate: async (watching) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<WatchView>(key)
      if (previous) {
        const delta = watching === previous.watching ? 0 : watching ? 1 : -1
        queryClient.setQueryData<WatchView>(key, {
          ...previous,
          watching,
          count: Math.max(0, (previous.count ?? 0) + delta),
        })
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
