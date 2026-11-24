import type { QueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewItem, ViewQueryResponse } from '../../api/types'

type ViewPages = InfiniteData<ViewQueryResponse>

/** Applies `fn` to the task in every cached view page of the Workspace (AD-20). */
export function mapTaskInViews(
  queryClient: QueryClient,
  workspaceId: string,
  taskId: string,
  fn: (task: TaskView) => TaskView,
) {
  queryClient.setQueriesData<ViewPages>({ queryKey: queryKeys.viewsAll(workspaceId) }, (data) => {
    if (!data?.pages) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items?.map((item: ViewItem) =>
          item.task?.id === taskId && item.task ? { ...item, task: fn(item.task) } : item,
        ),
      })),
    }
  })
}

/** Optimistic change: merges `patch` into the task cache and every cached view page. */
export function patchTaskInCaches(
  queryClient: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: Partial<TaskView>,
) {
  queryClient.setQueryData<TaskView>(queryKeys.task(taskId), (task) =>
    task ? { ...task, ...patch } : task,
  )
  mapTaskInViews(queryClient, workspaceId, taskId, (task) => ({ ...task, ...patch }))
}

/** Writes the server's task (a response, a 409 body or a Live refetch) everywhere it is cached. */
export function writeTaskToCaches(queryClient: QueryClient, task: TaskView) {
  if (!task.id || !task.workspaceId) return
  queryClient.setQueryData(queryKeys.task(task.id), task)
  mapTaskInViews(queryClient, task.workspaceId, task.id, () => task)
}

/** The version a cached copy of the task has (task cache first, then any view page). */
export function cachedVersion(
  queryClient: QueryClient,
  workspaceId: string,
  taskId: string,
): number | undefined {
  const own = queryClient.getQueryData<TaskView>(queryKeys.task(taskId))
  if (own?.version != null) return own.version
  for (const [, data] of queryClient.getQueriesData<ViewPages>({
    queryKey: queryKeys.viewsAll(workspaceId),
  })) {
    for (const page of data?.pages ?? []) {
      const hit = page.items?.find((item) => item.task?.id === taskId)
      if (hit?.task?.version != null) return hit.task.version
    }
  }
  return undefined
}
