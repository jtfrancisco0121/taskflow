import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

export function useTask(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    enabled: !!taskId,
    queryFn: () => unwrap(api.GET('/api/v1/tasks/{id}', { params: { path: { id: taskId! } } })),
  })
}

/** The Workspace a task belongs to; on `/t/:taskId` it is the current Workspace (AD-3). */
export function useTaskWorkspaceId(taskId: string | undefined): string | undefined {
  return useTask(taskId).data?.workspaceId
}
