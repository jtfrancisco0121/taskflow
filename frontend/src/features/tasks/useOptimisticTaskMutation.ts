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
  const views = queryClient.getQueriesData({ queryKey: queryKeys.viewsAll(workspaceId) })
  const taskBefore = queryClient.getQueryData<TaskView>(queryKeys.task(id))
  // The task as cached before this write's own optimistic change: a saved group change is judged against it.
  const groupedBefore = cachedTask(queryClient, workspaceId, id)
  const restore = () => {
    views.forEach(([key, data]) => queryClient.setQueryData(key, data))
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
    // A 4xx is a refusal: nothing was written, so the snapshot is the truth.
    if (response.status >= 400 && response.status < 500) restore()
    else restoreAndRefresh()
    const error = toApiError(response, result.error)
    show(error instanceof ApiError ? messageOf(error) : messageOf(networkError()), 'error')
    return 'failed'
  }
  writeTaskToCaches(queryClient, result.data)
  // An activity still on its first load read before this write: restart it, not just invalidate.
  inBackground(cancelThenInvalidate(queryClient, activity))
  // A task that changed group is read again in every view (14yq6g334tg); otherwise only first loads restart.
  inBackground(
    refreshAfterTaskWrite(
      queryClient,
      workspaceId,
      firstLoads,
      regroups(groupedBefore, result.data),
    ),
  )
  return 'saved'
}
