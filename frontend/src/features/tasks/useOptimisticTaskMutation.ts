import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, messageOf, networkError, toApiError } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, firstLoadsOf, inBackground, restartQueries } from '../../api/refresh'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import {
  cachedTask,
  cachedVersion,
  patchTaskInCaches,
  refreshAfterTaskWrite,
  regroups,
  taskFirstLoadFilters,
  viewFetchesOf,
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
      const run = previous.then(() => execute(queryClient, job))
      const settled = run.then(
        () => undefined,
        () => undefined,
      )
      queues.set(id, settled)
      void settled.then(() => {
        if (queues.get(id) === settled) queues.delete(id)
      })
      return run.finally(() => end(id))
    },
    [queryClient],
  )
}

async function execute(queryClient: QueryClient, job: TaskJob): Promise<TaskOutcome> {
  const workspaceId = job.task.workspaceId!
  const id = job.task.id!
  const show: (message: string, kind?: 'info' | 'error') => void = job.silent
    ? () => undefined
    : useToastStore.getState().show
  const cache = queryClient.getQueryCache()
  const views = cache
    .findAll({ queryKey: queryKeys.viewsAll(workspaceId) })
    .map((query) => ({ query, data: query.state.data }))
  const taskBefore = queryClient.getQueryData<TaskView>(queryKeys.task(id))
  // The task as cached before this write's own optimistic change: a saved group change is judged against it.
  const groupedBefore = cachedTask(queryClient, workspaceId, id)
  const restore = () => {
    views.forEach(({ query, data }) => queryClient.setQueryData(query.queryKey, data))
    queryClient.setQueryData(queryKeys.task(id), taskBefore)
  }
  const activity = { queryKey: queryKeys.activity(id) }
  // No answer, or a 5xx that may come after the commit: the write may have landed. Put back what we had, then read
  // the server's truth for everything that shows the task (cancel first, so first loads restart too).
  const restoreAndRefresh = () => {
    restore()
    inBackground(
      cancelThenInvalidate(queryClient, ...taskFirstLoadFilters(workspaceId, id), activity),
    )
  }
  if (job.apply) job.apply(queryClient)
  if (job.optimistic) patchTaskInCaches(queryClient, workspaceId, id, job.optimistic)
  // What this write itself left in each view: a view holding other data by the answer changed meanwhile.
  const applied = new Map(views.map(({ query }) => [query, query.state.data]))
  // Whether this write showed the task in another group (a Board card moved, a grouping field patched).
  const shownRegrouped =
    !!job.apply ||
    (!!job.optimistic && regroups(groupedBefore, { ...groupedBefore, ...job.optimistic }))
  /**
   * 14yq6g334tg r2: a refusal (4xx) wrote nothing, so this write's own change is undone, and only that. A view that
   * still holds what this write left in it gets its snapshot back. A view that changed meanwhile (another save's
   * refresh, a Live event, a Load more) is not put back: its snapshot is older than that change (in a Bulk change, it
   * would move a task saved meanwhile back to its old column). Those views, the view reads in flight, and every view
   * when the task was shown in another group, are read again (gathered, like after a save).
   */
  const refuse = (viewFetches: Set<string>) => {
    const changed = new Set<string>()
    for (const { query, data } of views) {
      // On its first load at the start: whatever it holds now came from the server, after this write began.
      if (data === undefined) continue
      if (cache.get(query.queryHash) === query && query.state.data === applied.get(query))
        queryClient.setQueryData(query.queryKey, data)
      else changed.add(query.queryHash)
    }
    queryClient.setQueryData(queryKeys.task(id), taskBefore)
    inBackground(
      refreshAfterTaskWrite(
        queryClient,
        workspaceId,
        new Set(),
        new Set([...viewFetches, ...changed]),
        shownRegrouped,
      ),
    )
  }

  let result: SendResult
  try {
    result = await job.send(cachedVersion(queryClient, workspaceId, id) ?? job.task.version)
  } catch {
    restoreAndRefresh()
    show(messageOf(networkError()), 'error')
    return 'failed'
  }
  const { response } = result
  const firstLoads = firstLoadsOf(queryClient, ...taskFirstLoadFilters(workspaceId, id))
  const viewFetches = viewFetchesOf(queryClient, workspaceId)
  if (response.status === 409) {
    const current = (result.error as { current?: TaskView } | undefined)?.current
    if (current) {
      // The server's task replaces our guess everywhere, including where a card moved.
      restore()
      writeTaskToCaches(queryClient, current)
      show(CONFLICT_MESSAGE, 'error')
      // Views on their first load are refetched by the restart; invalidating them here too would refetch twice.
      // eslint-disable-next-line no-restricted-syntax -- first-load safe: first loads are excluded, restarted below
      void queryClient.invalidateQueries({
        queryKey: queryKeys.viewsAll(workspaceId),
        predicate: (query) => !firstLoads.has(query.queryHash),
      })
      inBackground(restartQueries(queryClient, firstLoads))
      // The other writer's change is in the activity; its Live event will now look stale and be dropped.
      inBackground(cancelThenInvalidate(queryClient, activity))
      return 'conflict'
    }
  }
  if (!response.ok || !result.data) {
    // A 4xx is a refusal: nothing was written; this write's own change is undone (see refuse).
    if (response.status >= 400 && response.status < 500) refuse(viewFetches)
    else restoreAndRefresh()
    const error = toApiError(response, result.error)
    show(error instanceof ApiError ? messageOf(error) : messageOf(networkError()), 'error')
    return 'failed'
  }
  writeTaskToCaches(queryClient, result.data)
  // An activity still on its first load read before this write: restart it, not just invalidate.
  inBackground(cancelThenInvalidate(queryClient, activity))
  // A task that changed group is read again in every view (14yq6g334tg); a view read in flight is read again anyway.
  inBackground(
    refreshAfterTaskWrite(
      queryClient,
      workspaceId,
      firstLoads,
      viewFetches,
      regroups(groupedBefore, result.data),
    ),
  )
  return 'saved'
}
