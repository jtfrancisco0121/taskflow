import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'

/** AD-13: a task create invalidates every task list of the Workspace (List, Folder and Space views). */
export function useCreateTask(workspaceId: string, listId: string) {
  const queryClient = useQueryClient()
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (title: string) => {
      const body = { title }
      return unwrap(
        api.POST('/api/v1/lists/{id}/tasks', {
          params: { path: { id: listId } },
          body,
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      )
    },
    onSuccess: async () => {
      keys.current.done()
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll(workspaceId) })
    },
  })
}
