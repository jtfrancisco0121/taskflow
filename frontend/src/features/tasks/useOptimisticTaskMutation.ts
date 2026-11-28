import {
  useQueryClient,
  type InfiniteData,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, messageOf, networkError, toApiError } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import {
  cancelThenInvalidate,
  fetchesInFlightOf,
  inBackground,
  isLoadingMore,
  restartQueries,
} from '../../api/refresh'
import type { TaskView, ViewQueryResponse } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import {
  cachedTask,
  freshestVersion,
  patchTaskInCaches,
  refreshAfterTaskWrite,
  regroups,
  regroupsInViews,
  taskFirstLoadFilters,
  viewFetchesOf,
  viewSnapshots,
  viewsTouchedBy,
  writeTaskToCaches,
} from './taskCaches'

export const CONFLICT_MESSAGE = 'This task changed. Review and try again.'

export type SendResult = { response: Response; data?: TaskView; error?: unknown }

export type TaskJob = {
  task: Pick<TaskView, 'id' | 'workspaceId' | 'version'>
  /** Shown at once in every cached view and the task cache; rolled back on failure. */
  optimistic?: Partial<TaskView>
  /** A custom cache change (a Board card changing column); rolled back with the same snapshot. */
  apply?: (queryClient: QueryClient) => void
  /** Bulk fan-out reports its own summary, so no per-task toast. */
  silent?: boolean
  /** The request, sent with the task's current cached version for `If-Match`. */
  send: (version: number | undefined) => Promise<SendResult>
}

export type TaskOutcome = 'saved' | 'conflict' | 'failed'

/**
 * AD-20 gate: while a mutation on a task is pending, Live events for that task are held and
 * applied when it settles (the realtime cache patcher registers through `whenSettled`).
 */
const pending = new Map<string, number>()
const waiting = new Map<string, Array<() => void>>()
const queues = new Map<string, Promise<unknown>>()

export const taskMutationGate = {
  isPending: (taskId: string) => (pending.get(taskId) ?? 0) > 0,
  /** Runs `fn` now when nothing is pending for the task, otherwise after the last one settles. */
  whenSettled(taskId: string, fn: () => void) {
    if (!taskMutationGate.isPending(taskId)) return fn()
    waiting.set(taskId, [...(waiting.get(taskId) ?? []), fn])
  },
}

function begin(taskId: string) {
  pending.set(taskId, (pending.get(taskId) ?? 0) + 1)
}

function end(taskId: string) {
  const left = (pending.get(taskId) ?? 1) - 1
  if (left > 0) return pending.set(taskId, left)
  pending.delete(taskId)
  const callbacks = waiting.get(taskId) ?? []
  waiting.delete(taskId)
  callbacks.forEach((fn) => fn())
}

/**
 * One optimistic write for every renderer (Board drops, Calendar drops, inline edits and each Bulk
 * item). It patches the caches first, restores the snapshot on error, writes the 409 body's task on
 * a conflict, toasts, and refreshes the activity afterwards. Writes to one task run in order.
 */
export function useOptimisticTaskMutation() {
  const queryClient = useQueryClient()
  return useCallback(
    (job: TaskJob): Promise<TaskOutcome> => {
      const id = job.task.id!
      begin(id)
      const previous = queues.get(id) ?? Promise.resolve()
      // The next write to this task waits for this one's refresh too (14yq6g334bn): after a lost response it would
      // otherwise send the version from before the refresh and get a 409 for the user's own earlier edit.
      let after: Promise<unknown> | undefined
      const run = previous.then(() => execute(queryClient, job, (refresh) => (after = refresh)))
      const settled = run.then(
        () => after,
        () => undefined,
      )
      const idle = settled.then(
        () => undefined,
        () => undefined,
      )
      queues.set(id, idle)
      void idle.then(() => {
        if (queues.get(id) === idle) queues.delete(id)
      })
      return run.finally(() => end(id))
    },
    [queryClient],
  )
}

type Pages = InfiniteData<ViewQueryResponse>

/**
 * Puts the task's copy from `snapshot` back into a view's current pages; the view's other changes stay. Only when the
 * copy there is still the one this write patched (same version as in `applied`): a newer copy came from another save
 * (a task panel edit) or the server and is kept (PR #45 review r1 m1).
 */
function putTaskBack(
  queryClient: QueryClient,
  queryKey: QueryKey,
  snapshot: unknown,
  taskId: string,
  applied: unknown,
) {
  const find = (data: unknown) => {
    for (const page of (data as Pages | undefined)?.pages ?? []) {
      const hit = page.items?.find((item) => item.task?.id === taskId)?.task
      if (hit) return hit
    }
    return undefined
  }
  const copy = find(snapshot)
  if (!copy) return
  const patchedVersion = find(applied)?.version
  queryClient.setQueryData<Pages>(queryKey, (data) =>
    data?.pages
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items?.map((item) =>
              item.task?.id === taskId && item.task.version === patchedVersion
                ? { ...item, task: copy }
                : item,
            ),
          })),
        }
      : data,
  )
}

/** `waitFor` gets the refresh the next queued write to this task must wait for (after an unknown outcome). */
async function execute(
  queryClient: QueryClient,
  job: TaskJob,
  waitFor: (refresh: Promise<unknown>) => void,
): Promise<TaskOutcome> {
  const workspaceId = job.task.workspaceId!
  const id = job.task.id!
  const show: (message: string, kind?: 'info' | 'error') => void = job.silent
    ? () => undefined
    : useToastStore.getState().show
  const cache = queryClient.getQueryCache()
  const filters = taskFirstLoadFilters(workspaceId, id)
  // 14yq6g334bn (m2): a read of loaded data in flight now left before this write and would land over its optimistic
  // change (a card jumps back until the refresh). It is cancelled (its request aborted; a Load more is left alone)
  // and read again once the answer is in. A first load holds nothing to overwrite: it is judged at the answer.
  const startFetches = new Set(
    [...fetchesInFlightOf(queryClient, ...filters)].filter((hash) => {
      const query = cache.get(hash)
      return !!query && query.state.data !== undefined && !isLoadingMore(query)
    }),
  )
  if (startFetches.size > 0)
    void queryClient.cancelQueries({ predicate: (query) => startFetches.has(query.queryHash) })
  const views = viewSnapshots(queryClient, workspaceId)
  const taskQuery = () => cache.find({ queryKey: queryKeys.task(id), exact: true })
  const taskBefore = queryClient.getQueryData<TaskView>(queryKeys.task(id))
  // The task as cached before this write's own optimistic change: a saved group change is judged against it.
  const groupedBefore = cachedTask(queryClient, workspaceId, id)
  const activity = { queryKey: queryKeys.activity(id) }
  if (job.apply) job.apply(queryClient)
  if (job.optimistic) patchTaskInCaches(queryClient, workspaceId, id, job.optimistic)
  // What this write itself left in each view and in the task cache: one holding other data later changed meanwhile.
  const applied = new Map(views.map(({ query }) => [query, query.state.data]))
  const appliedTask = taskQuery()
  const appliedTaskData = appliedTask?.state.data
  // Whether this write showed the task in another group (a Board card moved, a grouping field patched).
  const shownRegrouped =
    !!job.apply ||
    (!!job.optimistic && regroups(groupedBefore, { ...groupedBefore, ...job.optimistic }))
  const viewHashes = new Set(views.map(({ query }) => query.queryHash))
  const startViews = new Set([...startFetches].filter((hash) => viewHashes.has(hash)))
  const startOthers = new Set([...startFetches].filter((hash) => !viewHashes.has(hash)))

  /**
   * Undoes this write's own change, and only that (14yq6g334tg r2, 14yq6g334bn m1). A view or task cache that still
   * holds what this write left in it, and was not read from the server since, gets its snapshot back. One that
   * changed meanwhile (another save of a Bulk change, a Live event, a Load more) is not put back: its snapshot is
   * older than that change. Returns those changed views, to read again; a view served by the server is left as is.
   */
  const undo = (): Set<string> => {
    const changed = new Set<string>()
    for (const { query, data } of views) {
      // On its first load at the start: whatever it holds now came from the server, after this write began.
      if (data === undefined || served.has(query)) continue
      if (cache.get(query.queryHash) === query && query.state.data === applied.get(query))
        queryClient.setQueryData(query.queryKey, data)
      else {
        changed.add(query.queryHash)
        // A plain field patch is undone in place: the task's own copy goes back, the rest of the view stays.
        if (!job.apply) putTaskBack(queryClient, query.queryKey, data, id, applied.get(query))
      }
    }
    const now = taskQuery()
    if (!now || (now === appliedTask && !served.has(now) && now.state.data === appliedTaskData))
      queryClient.setQueryData(queryKeys.task(id), taskBefore)
    return changed
  }
  /** A refusal (4xx) wrote nothing: undo, then read again the views that changed and the reads cancelled at start. */
  const refuse = () => {
    const changed = undo()
    // PR #45 review 2: a Load more in flight rebuilds its pages from the cache it started with, which may hold this
    // write's change: it is read again once it lands (restartQueries never cancels a Load more).
    const loadingMore = new Set(
      views.flatMap(({ query }) =>
        cache.get(query.queryHash) === query && isLoadingMore(query) ? [query.queryHash] : [],
      ),
    )
    inBackground(restartQueries(queryClient, loadingMore))
    const reread = new Set(
      [...startViews, ...changed].filter(
        (hash) => cache.get(hash)?.state.fetchStatus !== 'fetching',
      ),
    )
    // PR #35 review item 2: no view read in flight is cancelled here: none can hold a write that did not happen.
    inBackground(
      refreshAfterTaskWrite(queryClient, workspaceId, startOthers, reread, shownRegrouped),
    )
  }
  /**
   * No answer, or a 5xx that may come after the commit: the write may have landed. Read the server's truth for
   * everything that shows the task first (cancel first, so reads in flight restart too), and only then undo what no
   * read replaced (14yq6g334bn: putting the snapshot back first flickered HIGH, LOW, HIGH when the write had landed).
   */
  const refreshThenUndo = () =>
    cancelThenInvalidate(queryClient, ...filters, activity).then(
      () => undo(),
      () => undo(),
    )

  // Queries that received a server read after this write's own change: their data is the server's, never put back.
  // Watched until the answer, or until the refresh that undoes afterwards is done.
  const served = new Set<Query>()
  const stopWatching = cache.subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual)
      served.add(event.query)
  })
  let watching = false
  const watchUntil = (refresh: Promise<unknown>) => {
    watching = true
    waitFor(refresh.finally(stopWatching))
  }

  try {
    let result: SendResult
    try {
      result = await job.send(freshestVersion(queryClient, workspaceId, id) ?? job.task.version)
    } catch {
      show(messageOf(networkError()), 'error')
      watchUntil(refreshThenUndo())
      return 'failed'
    }
    const { response } = result
    const firstLoads = new Set([...fetchesInFlightOf(queryClient, ...filters), ...startOthers])
    const viewFetches = new Set([...viewFetchesOf(queryClient, workspaceId), ...startViews])
    if (response.status === 409) {
      const current = (result.error as { current?: TaskView } | undefined)?.current
      if (current) {
        // The server's task replaces our guess everywhere, including where a card moved; a view another save
        // changed meanwhile keeps that change (m1).
        undo()
        writeTaskToCaches(queryClient, current)
        show(CONFLICT_MESSAGE, 'error')
        // Views with a read in flight are restarted; invalidating them here too would read twice.
        // eslint-disable-next-line no-restricted-syntax -- first-load safe: reads in flight are excluded, restarted below
        void queryClient.invalidateQueries({
          queryKey: queryKeys.viewsAll(workspaceId),
          predicate: (query) =>
            !firstLoads.has(query.queryHash) && !viewFetches.has(query.queryHash),
        })
        inBackground(restartQueries(queryClient, new Set([...firstLoads, ...viewFetches])))
        // The other writer's change is in the activity; its Live event will now look stale and be dropped.
        inBackground(cancelThenInvalidate(queryClient, activity))
        return 'conflict'
      }
    }
    if (!response.ok || !result.data) {
      const error = toApiError(response, result.error)
      show(error instanceof ApiError ? messageOf(error) : messageOf(networkError()), 'error')
      // A 4xx is a refusal: nothing was written; this write's own change is undone (see refuse).
      if (response.status >= 400 && response.status < 500) {
        refuse()
        return 'failed'
      }
      watchUntil(refreshThenUndo())
      return 'failed'
    }
    const saved = result.data
    writeTaskToCaches(queryClient, saved)
    // An activity still on its first load read before this write: restart it, not just invalidate.
    inBackground(cancelThenInvalidate(queryClient, activity))
    // A task that changed group is read again in every view (14yq6g334tg), judged against the task cache and each
    // view's own copy (m3); a view filtering or sorting by a changed field, and a view read in flight, are read again.
    const regrouped =
      shownRegrouped || regroups(groupedBefore, saved) || regroupsInViews(views, saved)
    for (const hash of viewsTouchedBy(views, groupedBefore, saved)) viewFetches.add(hash)
    inBackground(
      refreshAfterTaskWrite(queryClient, workspaceId, firstLoads, viewFetches, regrouped),
    )
    return 'saved'
  } finally {
    if (!watching) stopWatching()
  }
}
