import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { networkError, toApiError } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import type { TaskView } from '../../api/types'

export type TaskPatch = components['schemas']['UpdateTaskRequest']

export type UpdateResult =
  { kind: 'saved'; task: TaskView } | { kind: 'conflict'; current: TaskView; attempted: TaskPatch }

type TaskPage = { items?: TaskView[]; nextCursor?: string }

/** Replaces the task in every cached task list of the Workspace (List, Folder and Space views). */
function replaceInLists(queryClient: QueryClient, task: TaskView) {
  if (!task.workspaceId) return
  queryClient.setQueriesData<InfiniteData<TaskPage>>(
    { queryKey: queryKeys.tasksAll(task.workspaceId) },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items?.map((item) => (item.id === task.id ? task : item)),
        })),
      },
  )
}

/**
 * AD-5: the one write path for a task. It sends `If-Match` with the cached version, writes the
 * response to `['task', id]` and the cached rows, and on 409 writes the server's current task and
 * returns it with the attempted change. It never retries on its own. Writes are queued so two quick
 * edits cannot conflict with each other.
 */
export function useUpdateTask(taskId: string) {
  const queryClient = useQueryClient()
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const send = async (patch: TaskPatch): Promise<UpdateResult> => {
    const cached = queryClient.getQueryData<TaskView>(queryKeys.task(taskId))
    let result
    try {
      result = await api.PATCH('/api/v1/tasks/{id}', {
        params: {
          path: { id: taskId },
          header: cached?.version != null ? { 'If-Match': `"${cached.version}"` } : {},
        },
        body: patch,
      })
    } catch {
      throw networkError()
    }
    const { response } = result
    if (response.status === 409) {
      const current = (result.error as { current?: TaskView } | undefined)?.current
      if (current) {
        queryClient.setQueryData(queryKeys.task(taskId), current)
        replaceInLists(queryClient, current)
        void queryClient.invalidateQueries({ queryKey: queryKeys.activity(taskId) })
        return { kind: 'conflict', current, attempted: patch }
      }
    }
    if (!response.ok || !result.data) throw toApiError(response, result.error)
    queryClient.setQueryData(queryKeys.task(taskId), result.data)
    replaceInLists(queryClient, result.data)
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(taskId) })
    return { kind: 'saved', task: result.data }
  }

  return useMutation({
    mutationFn: (patch: TaskPatch) => {
      const next = queue.current.then(
        () => send(patch),
        () => send(patch),
      )
      queue.current = next.catch(() => undefined)
      return next
    },
  })
}
