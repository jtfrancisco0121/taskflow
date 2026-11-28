import {
  matchQuery,
  type InfiniteData,
  type InvalidateQueryFilters,
  type Query,
  type QueryClient,
} from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { inBackground, isLoadingMore, restartQueries } from '../../api/refresh'
import type { TaskView, ViewConfig, ViewItem, ViewQueryResponse } from '../../api/types'

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

/**
 * PR #45 review 1: the newest version any cached copy of the task holds (task cache, view pages, subtask scans), for a
 * write's If-Match. Versions only grow, so the highest is the freshest: a task detail no screen shows is not refetched
 * by a refresh and can be older than the views that were.
 */
export function freshestVersion(
  queryClient: QueryClient,
  workspaceId: string,
  taskId: string,
): number | undefined {
  const versions: number[] = []
  const own = queryClient.getQueryData<TaskView>(queryKeys.task(taskId))
  if (own?.version != null) versions.push(own.version)
  for (const [, data] of queryClient.getQueriesData<ViewPages>({
    queryKey: queryKeys.viewsAll(workspaceId),
  }))
    for (const page of data?.pages ?? [])
      for (const item of page.items ?? [])
        if (item.task?.id === taskId && item.task.version != null) versions.push(item.task.version)
  for (const [, scan] of queryClient.getQueriesData<SubtaskScan>({
    queryKey: queryKeys.subtaskScanAll(),
  }))
    for (const t of scan?.tasks ?? [])
      if (t.id === taskId && t.version != null) versions.push(t.version)
  return versions.length > 0 ? Math.max(...versions) : undefined
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

/** Deep equality of JSON values; object key order does not matter, array order does. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** An empty custom field value: absent, null, "" or [] are all the same "No value" group (PR #35 review item 4). */
const emptyValue = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** Custom field values without the empty ones. */
const setFields = (fields: TaskView['customFields']) =>
  Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => !emptyValue(v)))

/**
 * 14yq6g334tg: whether a write moved the task to another group of a view (a Board column, a grouped List section).
 * writeTaskToCaches only updates a task where it is listed, so a changed group needs the views read again. An
 * unknown `before` counts as changed.
 *
 * The fields are the view groupings the server accepts (ViewConfigValidator.GROUPS plus `cf:<field id>`): status and
 * status group (statusId), priority, assignee, list, dueDate and any custom field (compared deeply: a value can be an
 * array or an object). Listed on purpose rather than "anything but the title": every save bumps version and
 * updatedAt, and tags, dates or the description group nothing, so a wider rule would read every view after every
 * save and undo the gathered refresh of a Bulk change.
 */
export function regroups(before: TaskView | undefined, after: TaskView): boolean {
  if (!before) return true
  return (
    before.statusId !== after.statusId ||
    before.priority !== after.priority ||
    before.listId !== after.listId ||
    (before.dueDate ?? null) !== (after.dueDate ?? null) ||
    !sameSet(before.assigneeIds, after.assigneeIds) ||
    !sameJson(setFields(before.customFields), setFields(after.customFields))
  )
}

const sorted = (values: string[] = []) => [...values].sort()

/**
 * 14yq6g334bn: how a view config names a task field (ViewConfigValidator: groupings, sort keys, filter fields, plus
 * `cf:<field id>`), read from a task. `manual` (the drag rank) is left out: a drag changes it through `apply`.
 */
const FIELD_VALUE: Record<string, (task: TaskView) => unknown> = {
  title: (t) => t.title,
  status: (t) => t.statusId,
  statusGroup: (t) => t.statusId,
  list: (t) => t.listId,
  priority: (t) => t.priority,
  assignee: (t) => sorted(t.assigneeIds),
  tag: (t) => sorted(t.tags),
  dueDate: (t) => t.dueDate ?? null,
  startDate: (t) => t.startDate ?? null,
  createdAt: (t) => t.createdAt ?? null,
  updatedAt: (t) => t.updatedAt ?? null,
  subtasks: (t) => t.parentTaskId ?? null,
  blocked: (t) => !!t.blocked,
}

function fieldValue(task: TaskView, field: string): unknown {
  if (field.startsWith('cf:')) return setFields(task.customFields)[field.slice(3)] ?? null
  return FIELD_VALUE[field]?.(task)
}

/** Every task field a view config groups, filters or sorts by. */
function fieldsOf(config: ViewConfig): Set<string> {
  const fields = new Set<string>()
  if (config.group && config.group !== 'none') fields.add(config.group)
  for (const sort of config.sort ?? []) if (sort.key && sort.key !== 'manual') fields.add(sort.key)
  const walk = (filter: ViewConfig['filter']) => {
    if (!filter) return
    if (filter.field) fields.add(filter.field)
    filter.items?.forEach(walk)
  }
  walk(config.filter)
  return fields
}

/** The task as one view's pages hold it, if they do. */
function taskInView(data: ViewPages | undefined, taskId: string): TaskView | undefined {
  for (const page of data?.pages ?? []) {
    const hit = page.items?.find((item) => item.task?.id === taskId)
    if (hit?.task) return hit.task
  }
  return undefined
}

export type ViewSnapshot = { query: Query; data: unknown }

/**
 * 14yq6g334bn: the loaded views a saved task must be read again in, judged against each view's own config (its
 * grouping, filters and sorts; useViewTasks puts it in the query's meta) and each view's own copy of the task (a task
 * cache can be older than the view, m3). A view not holding the task is judged against `before`; a view whose copy
 * cannot be known is read again. `views` are the views as they were before the write's own change.
 */
export function viewsTouchedBy(
  views: ViewSnapshot[],
  before: TaskView | undefined,
  after: TaskView,
): Set<string> {
  const hashes = new Set<string>()
  for (const { query, data } of views) {
    const config = (query.meta as { viewConfig?: ViewConfig } | undefined)?.viewConfig
    if (data === undefined || !config) continue
    const copy = taskInView(data as ViewPages, after.id!) ?? before
    if (
      !copy ||
      [...fieldsOf(config)].some((f) => !sameJson(fieldValue(copy, f), fieldValue(after, f)))
    )
      hashes.add(query.queryHash)
  }
  return hashes
}

/** Whether any view's own copy of the task (before the write) sits in another group than `after` (m3). */
export function regroupsInViews(views: ViewSnapshot[], after: TaskView): boolean {
  return views.some(({ data }) => {
    const copy = taskInView(data as ViewPages | undefined, after.id!)
    return !!copy && regroups(copy, after)
  })
}

/** The views of the Workspace and what each holds now. */
export function viewSnapshots(queryClient: QueryClient, workspaceId: string): ViewSnapshot[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.viewsAll(workspaceId) })
    .map((query) => ({ query, data: query.state.data }))
}

/**
 * 14yq6g334tg: the view queries of the Workspace with a fetch in flight (a first load, a refetch, a Load more). Their
 * answers may have been read before a write commits; snapshot this before the write's response is cached.
 */
export function viewFetchesOf(queryClient: QueryClient, workspaceId: string): Set<string> {
  const hashes = new Set<string>()
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.viewsAll(workspaceId), fetchStatus: 'fetching' }))
    hashes.add(query.queryHash)
  return hashes
}

/** How long view refreshes after saves are gathered into one read (a Bulk change saves up to 6 at once). */
export const VIEW_REFRESH_MS = 100

type ScheduledViews = {
  /** Workspaces whose views are all read again (a save changed a task's group). */
  all: Set<string>
  /** Single view queries read again (their fetch was in flight at a save). */
  hashes: Set<string>
  timer?: ReturnType<typeof setTimeout>
}
const scheduledViews = new WeakMap<QueryClient, ScheduledViews>()

/**
 * Reads the scheduled views again, once. Every view fetch in flight at a save was cancelled then, so a fetch in flight
 * now started after the saves and is left to finish. A Load more is not cancelled: its query is read after it lands.
 */
function flushViews(queryClient: QueryClient) {
  const scheduled = scheduledViews.get(queryClient)
  if (!scheduled) return
  scheduledViews.delete(queryClient)
  const targets = queryClient.getQueryCache().findAll({
    predicate: (query) =>
      scheduled.hashes.has(query.queryHash) ||
      [...scheduled.all].some((ws) => matchQuery({ queryKey: queryKeys.viewsAll(ws) }, query)),
  })
  const refetch = new Set<Query>()
  for (const query of targets) {
    const load = query.promise
    if (isLoadingMore(query) && load) {
      const after = () => {
        // eslint-disable-next-line no-restricted-syntax -- first-load safe: the query has data (a Load more ran)
        void queryClient.invalidateQueries({ predicate: (q) => q === query })
      }
      load.then(after, after)
    } else if (query.state.fetchStatus !== 'fetching') refetch.add(query)
  }
  if (refetch.size > 0)
    // eslint-disable-next-line no-restricted-syntax -- first-load safe: none of these has a fetch in flight
    inBackground(queryClient.invalidateQueries({ predicate: (query) => refetch.has(query) }))
}

/** Runs the gathered view refresh now instead of after VIEW_REFRESH_MS (tests prove "no read" without waiting). */
export function flushViewRefreshNow(queryClient: QueryClient) {
  const scheduled = scheduledViews.get(queryClient)
  if (scheduled?.timer) clearTimeout(scheduled.timer)
  flushViews(queryClient)
}

/**
 * After a saved write (written to the caches already). `firstLoads` (firstLoadsOf before the write) outside the views
 * restart now. In the views, every fetch that was in flight at the save (`viewFetches`, viewFetchesOf before the
 * write) read before the commit and could land last, over this write or a later one: it is cancelled now (its request
 * is aborted, unless it is a Load more) and read again. When the task changed group, every view of the Workspace is
 * read again too, loaded or not, so each Board column and its count follow the task to its new group. The view reads
 * of saves within VIEW_REFRESH_MS are gathered into one, so a Bulk change reads each view about once, not once a task.
 */
export function refreshAfterTaskWrite(
  queryClient: QueryClient,
  workspaceId: string,
  firstLoads: Set<string>,
  viewFetches: Set<string>,
  regrouped: boolean,
) {
  const views = { queryKey: queryKeys.viewsAll(workspaceId) }
  const cache = queryClient.getQueryCache()
  const stale = cache.findAll({ predicate: (query) => viewFetches.has(query.queryHash) })
  const cancel = new Set(stale.filter((query) => !isLoadingMore(query)))
  if (cancel.size > 0) void queryClient.cancelQueries({ predicate: (query) => cancel.has(query) })
  if (regrouped || viewFetches.size > 0) {
    let scheduled = scheduledViews.get(queryClient)
    if (!scheduled)
      scheduledViews.set(queryClient, (scheduled = { all: new Set(), hashes: new Set() }))
    if (regrouped) scheduled.all.add(workspaceId)
    viewFetches.forEach((hash) => scheduled.hashes.add(hash))
    scheduled.timer ??= setTimeout(() => flushViews(queryClient), VIEW_REFRESH_MS)
  }
  const others = new Set(
    [...firstLoads].filter((hash) => {
      const query = cache.get(hash)
      return !query || !matchQuery(views, query)
    }),
  )
  return restartQueries(queryClient, others)
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
