import {
  matchQuery,
  type InfiniteData,
  type InvalidateQueryFilters,
  type QueryClient,
} from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, restartQueries } from '../../api/refresh'
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

/**
 * Refetches the loaded subtask scans of one List, or of every List. Used today only by the realtime debounced rescan
 * after a task this tab never saw changed. Callers must cover first loads themselves: a plain invalidate does not
 * restart a scan still on its first load. The realtime caller does (refreshTaskFirstLoads at event time); a write
 * path (a trash, a restore) must use cancelThenInvalidate from src/api/refresh.ts instead of this.
 */
export function invalidateSubtaskScans(queryClient: QueryClient, listId?: string) {
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

/** The cached copy of a task (task cache first, then any view page), or undefined when none is cached. */
export function cachedTask(
  queryClient: QueryClient,
  workspaceId: string,
  taskId: string,
): TaskView | undefined {
  const own = queryClient.getQueryData<TaskView>(queryKeys.task(taskId))
  if (own) return own
  for (const [, data] of queryClient.getQueriesData<ViewPages>({
    queryKey: queryKeys.viewsAll(workspaceId),
  })) {
    for (const page of data?.pages ?? []) {
      const hit = page.items?.find((item) => item.task?.id === taskId)
      if (hit?.task) return hit.task
    }
  }
  return undefined
}

const sameSet = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

/**
 * 14yq6g334tg: whether a write moved the task to another group of a view (a Board column, a grouped List section):
 * its status, priority, assignees or List changed. writeTaskToCaches only updates a task where it is listed, so a
 * changed group needs the views read again. An unknown `before` counts as changed.
 */
export function regroups(before: TaskView | undefined, after: TaskView): boolean {
  if (!before) return true
  return (
    before.statusId !== after.statusId ||
    before.priority !== after.priority ||
    before.listId !== after.listId ||
    !sameSet(before.assigneeIds, after.assigneeIds)
  )
}

/**
 * After a saved write (written to the caches already): restart what was on its first load (`firstLoads`, from
 * firstLoadsOf before the write). When the task changed group, every view of the Workspace is read again too, loaded
 * or not, so each Board column and its count (the lead query) follow the task to its new group from one read after
 * the commit; first loads are cancelled first, so a read from before the commit cannot land last.
 */
export function refreshAfterTaskWrite(
  queryClient: QueryClient,
  workspaceId: string,
  firstLoads: Set<string>,
  regrouped: boolean,
) {
  if (!regrouped) return restartQueries(queryClient, firstLoads)
  const views = { queryKey: queryKeys.viewsAll(workspaceId) }
  return cancelThenInvalidate(queryClient, views, {
    predicate: (query) => firstLoads.has(query.queryHash) && !matchQuery(views, query),
  })
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
