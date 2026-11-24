import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import type { RichDoc } from '../../shared/richtext'

/** Comments, oldest first; the next page holds newer comments (`id > cursor`). */
export function useComments(taskId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.comments(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/tasks/{id}/comments', {
          params: { path: { id: taskId }, query: { cursor: pageParam, limit: 50 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

function useRefresh(taskId: string) {
  const queryClient = useQueryClient()
  // Every comment write refreshes the comments and the activity log (AD-5).
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(taskId) }),
    ])
}

export function useCreateComment(taskId: string) {
  const refresh = useRefresh(taskId)
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (body: RichDoc) =>
      unwrap(
        api.POST('/api/v1/tasks/{id}/comments', {
          params: { path: { id: taskId } },
          body: { body },
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      ),
    onSuccess: async () => {
      keys.current.done()
      await refresh()
    },
  })
}

export function useEditComment(taskId: string) {
  const refresh = useRefresh(taskId)
  return useMutation({
    mutationFn: (vars: { id: string; body: RichDoc }) =>
      unwrap(
        api.PATCH('/api/v1/comments/{id}', {
          params: { path: { id: vars.id } },
          body: { body: vars.body },
        }),
      ),
    onSuccess: refresh,
  })
}

export function useDeleteComment(taskId: string) {
  const refresh = useRefresh(taskId)
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/api/v1/comments/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
}
