import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import { invalidateSubtaskScans } from './taskCaches'

/** AD-13: a task create invalidates every task list of the Workspace (List, Folder and Space views). */
export function useCreateTask(workspaceId: string, listId: string) {
  const queryClient = useQueryClient()
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: ({ title, parentTaskId }: { title: string; parentTaskId?: string }) => {
      const body = parentTaskId ? { title, parentTaskId } : { title }
      return unwrap(
        api.POST('/api/v1/lists/{id}/tasks', {
          params: { path: { id: listId } },
          body,
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      )
    },
    onSuccess: async (_task, { parentTaskId }) => {
      keys.current.done()
      // A first load still in flight may have read the server before this task existed: restart it.
      const filters = [
        { queryKey: queryKeys.tasksAll(workspaceId) },
        { queryKey: queryKeys.viewsAll(workspaceId) },
      ]
      if (parentTaskId) {
        await queryClient.cancelQueries({ queryKey: queryKeys.subtaskScan(listId) })
        invalidateSubtaskScans(queryClient, listId)
      }
      await cancelThenInvalidate(queryClient, ...filters)
    },
  })
}
