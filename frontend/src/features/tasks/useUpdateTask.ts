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
import { cancelThenInvalidate, firstLoadsOf, inBackground, restartQueries } from '../../api/refresh'
import type { components } from '../../api/schema'
import type { TaskView } from '../../api/types'
import {
  refreshAfterTaskWrite,
  regroups,
  taskFirstLoadFilters,
  viewFetchesOf,
  writeTaskToCaches,
} from './taskCaches'

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

/** Lists, the task and the subtask scans still on their first load may have read the server before this write. */
function firstLoadsAt(queryClient: QueryClient, task: TaskView) {
  if (!task.workspaceId) return new Set<string>()
  return firstLoadsOf(queryClient, ...taskFirstLoadFilters(task.workspaceId, task.id!))
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
  // An activity still on its first load read before this write: restart it, not just invalidate.
  const refreshActivity = () =>
    inBackground(cancelThenInvalidate(queryClient, { queryKey: queryKeys.activity(taskId) }))

  // 14yq6g334tg: a task that changed group is read again in every view; a view read in flight is read again anyway.
  const viewFetchesAt = (task: TaskView) =>
    task.workspaceId ? viewFetchesOf(queryClient, task.workspaceId) : new Set<string>()
  const refreshAfter = (
    task: TaskView,
    firstLoads: Set<string>,
    viewFetches: Set<string>,
    regrouped: boolean,
  ) =>
    task.workspaceId
      ? refreshAfterTaskWrite(queryClient, task.workspaceId, firstLoads, viewFetches, regrouped)
      : restartQueries(queryClient, firstLoads)

  const send = async (patch: TaskPatch): Promise<UpdateResult> => {
    const cached = queryClient.getQueryData<TaskView>(queryKeys.task(taskId))
    // A group change (status, priority, assignees, List) is judged against this copy, cached before the write.
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
        const firstLoads = firstLoadsAt(queryClient, current)
        const viewFetches = viewFetchesAt(current)
        const regrouped = regroups(cached, current)
        writeTaskToCaches(queryClient, current)
        replaceInLists(queryClient, current)
        inBackground(refreshAfter(current, firstLoads, viewFetches, regrouped))
        refreshActivity()
        return { kind: 'conflict', current, attempted: patch }
      }
    }
    if (!response.ok || !result.data) throw toApiError(response, result.error)
    const firstLoads = firstLoadsAt(queryClient, result.data)
    const viewFetches = viewFetchesAt(result.data)
    const regrouped = regroups(cached, result.data)
    writeTaskToCaches(queryClient, result.data)
    replaceInLists(queryClient, result.data)
    inBackground(refreshAfter(result.data, firstLoads, viewFetches, regrouped))
    refreshActivity()
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
