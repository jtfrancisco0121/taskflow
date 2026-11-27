import type { InfiniteData, InvalidateQueryFilters, QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewItem, ViewQueryResponse } from '../../api/types'

type ViewPages = InfiniteData<ViewQueryResponse>

/** One List scan for the subtasks section (see useSubtasks). */
export type SubtaskScan = { tasks: TaskView[]; capped: boolean }

/** Replaces the task by id in every cached subtask scan; a changed `parentTaskId` moves it through `select`. */
function mapTaskInScans(
  queryClient: QueryClient,
  taskId: string,
  fn: (task: TaskView) => TaskView,
) {
  queryClient.setQueriesData<SubtaskScan>({ queryKey: queryKeys.subtaskScanAll() }, (scan) =>
    scan ? { ...scan, tasks: scan.tasks.map((t) => (t.id === taskId ? fn(t) : t)) } : scan,
  )
}

/** Refetches the scans of one List, or of every List: after a trash, a restore or an unseen task changed. */
export function invalidateSubtaskScans(queryClient: QueryClient, listId?: string) {
  // The realtime caller already refetches a scan that was on its first load at event time (refreshTaskFirstLoads).
  // eslint-disable-next-line no-restricted-syntax -- first-load safe: event-time first loads are covered
  void queryClient.invalidateQueries({
    queryKey: listId ? queryKeys.subtaskScan(listId) : queryKeys.subtaskScanAll(),
  })
}

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
  mapTaskInScans(queryClient, taskId, (task) => ({ ...task, ...patch }))
}

/** Writes the server's task (a response, a 409 body or a Live refetch) everywhere it is cached. */
export function writeTaskToCaches(queryClient: QueryClient, task: TaskView) {
  if (!task.id || !task.workspaceId) return
  queryClient.setQueryData(queryKeys.task(task.id), task)
  mapTaskInViews(queryClient, task.workspaceId, task.id, () => task)
  mapTaskInScans(queryClient, task.id, () => task)
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

/**
 * What a task write can have missed while it was on its first load (see restartQueries): the task lists, the views,
 * the task's own detail and the subtask scans. Snapshot with firstLoadsOf before the response is written to the caches.
 */
export function taskFirstLoadFilters(
  workspaceId: string,
  taskId: string,
): InvalidateQueryFilters[] {
  return [
    { queryKey: queryKeys.tasksAll(workspaceId) },
    { queryKey: queryKeys.viewsAll(workspaceId) },
    { queryKey: queryKeys.task(taskId), exact: true },
    { queryKey: queryKeys.subtaskScanAll() },
  ]
}
