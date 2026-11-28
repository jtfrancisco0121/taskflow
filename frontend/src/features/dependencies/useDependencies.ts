import {
  useMutation,
  useQuery,
  useQueryClient,
  type InvalidateQueryFilters,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../../api/client'
import { ApiError, messageOf, networkError, toApiError, unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { onceMoreIfBusy } from '../../api/retryAfter'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, inBackground, setDataRestartingFirstLoad } from '../../api/refresh'
import type { DependencyList, DependencyRelation, TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'

/** What a relationship change says when the tasks stayed busy after its one retry. */
export const BUSY_MESSAGE = 'These tasks are being changed right now. Try again.'

/** DEP: the relationships of a task, grouped as the server returns them. */
export function useDependencies(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dependencies(taskId ?? ''),
    enabled: !!taskId,
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks/{id}/dependencies', { params: { path: { id: taskId! } } })),
  })
}

const ifMatch = (version: number | undefined) =>
  version != null ? { 'If-Match': `"${version}"` } : {}

/**
 * A relationship change touches both tasks (versions bump on both ends), so after it the acting
 * task is replaced from the response and everything that may show either task is refreshed.
 */
function refresh(
  queryClient: QueryClient,
  task: TaskView,
  otherId: string | undefined,
  /** `task` is not the saved one (re-reading it failed): its detail is refetched instead of written. */
  unread = false,
) {
  // The acting task goes into its detail; one still on its first load read before this write, so it restarts.
  if (!unread) writeCurrent(queryClient, task.id!, task)
  const filters: InvalidateQueryFilters[] = []
  if (unread) filters.push({ queryKey: queryKeys.task(task.id!), exact: true })
  for (const id of [task.id!, otherId]) {
    if (!id) continue
    filters.push({ queryKey: queryKeys.dependencies(id) }, { queryKey: queryKeys.activity(id) })
  }
  if (otherId) filters.push({ queryKey: queryKeys.task(otherId), exact: true })
  const ws = task.workspaceId
  if (ws) filters.push({ queryKey: queryKeys.tasksAll(ws) }, { queryKey: queryKeys.viewsAll(ws) })
  // Started, not awaited: the mutation settles when the write has, not when every list has refetched.
  inBackground(cancelThenInvalidate(queryClient, ...filters))
}

/**
 * Writes `current` (a saved task, or the one a 409 answers with) into the task's detail; a detail still on its first
 * load (read before that write) is restarted in the background.
 */
function writeCurrent(queryClient: QueryClient, id: string, current: TaskView) {
  setDataRestartingFirstLoad(queryClient, queryKeys.task(id), current)
}

/**
 * The signal of the mounted component: aborted on unmount, so a busy retry still waiting out its Retry-After is called
 * off (ClickUp 14yq6g334bn). A fresh controller per mount, since StrictMode unmounts and mounts again.
 */
function useUnmountSignal(): () => AbortSignal {
  const controller = useRef(new AbortController())
  useEffect(() => {
    const mounted = new AbortController()
    controller.current = mounted
    return () => mounted.abort()
  }, [])
  return () => controller.current.signal
}

/** Adds a relationship from `task`'s side (POST, If-Match, one idempotency key per submission). */
export function useAddDependency(task: TaskView) {
  const queryClient = useQueryClient()
  const keys = useRef(new IdempotencyKeys())
  const unmounted = useUnmountSignal()
  return useMutation({
    mutationFn: async (input: { otherTaskId: string; relation: DependencyRelation }) => {
      const cached = queryClient.getQueryData<TaskView>(queryKeys.task(task.id!)) ?? task
      let result
      try {
        // A busy answer is not stored under the key, so the retry sends the same key.
        result = await onceMoreIfBusy(
          () =>
            api.POST('/api/v1/tasks/{id}/dependencies', {
              params: { path: { id: task.id! }, header: ifMatch(cached.version) },
              body: input,
              headers: { 'Idempotency-Key': keys.current.keyFor(input) },
            }),
          unmounted(),
        )
      } catch {
        throw networkError()
      }
      if (!result.response.ok || !result.data) {
        if (result.response.status === 409) {
          const current = (result.error as { current?: TaskView } | undefined)?.current
          if (current) writeCurrent(queryClient, task.id!, current)
        }
        throw toApiError(result.response, result.error)
      }
      return { ...result.data, otherTaskId: input.otherTaskId }
    },
    onSuccess: (added) => {
      keys.current.done()
      if (added.task) refresh(queryClient, added.task, added.otherTaskId)
    },
  })
}

/** Removes a relationship at once (optimistic) and puts it back with a toast when it fails. */
export function useRemoveDependency(task: TaskView) {
  const queryClient = useQueryClient()
  const unmounted = useUnmountSignal()
  return useMutation({
    mutationFn: async (input: { dependencyId: string; otherTaskId: string }) => {
      const cached = queryClient.getQueryData<TaskView>(queryKeys.task(task.id!)) ?? task
      let result
      try {
        result = await onceMoreIfBusy(
          () =>
            api.DELETE('/api/v1/tasks/{id}/dependencies/{dependencyId}', {
              params: {
                path: { id: task.id!, dependencyId: input.dependencyId },
                header: ifMatch(cached.version),
              },
            }),
          unmounted(),
        )
      } catch {
        throw networkError()
      }
      if (!result.response.ok) throw toApiError(result.response, result.error)
      // The 204 carries the task's new version as its ETag.
      const version = Number(result.response.headers.get('ETag')?.replace(/\D/g, '')) || undefined
      return { ...input, version }
    },
    onMutate: async (input) => {
      const key = queryKeys.dependencies(task.id!)
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<DependencyList>(key)
      if (before) {
        const without = (items: DependencyList['waitingOn']) =>
          items?.filter((i) => i.dependencyId !== input.dependencyId)
        queryClient.setQueryData<DependencyList>(key, {
          ...before,
          waitingOn: without(before.waitingOn),
          blocking: without(before.blocking),
          linked: without(before.linked),
        })
      }
      return { before }
    },
    onError: (error, _input, context) => {
      if (context?.before) {
        queryClient.setQueryData(queryKeys.dependencies(task.id!), context.before)
      } else {
        // onMutate cancelled a first load (nothing to put back): load the panel again.
        inBackground(
          cancelThenInvalidate(queryClient, { queryKey: queryKeys.dependencies(task.id!) }),
        )
      }
      const stale = error instanceof ApiError && error.code === 'task.version_conflict'
      if (stale) {
        const current = (error.body as { current?: TaskView } | undefined)?.current
        if (current) writeCurrent(queryClient, task.id!, current)
      }
      const busy = error instanceof ApiError && error.code === 'request.busy'
      useToastStore
        .getState()
        .show(
          stale ? 'This task changed. Try again.' : busy ? BUSY_MESSAGE : messageOf(error),
          'error',
        )
    },
    onSuccess: async (input) => {
      // The removal is saved: a failed re-read must not fail the mutation, or onError would put the row back.
      const { data } = await api
        .GET('/api/v1/tasks/{id}', { params: { path: { id: task.id! } } })
        .catch(() => ({ data: undefined }))
      // Until the detail's refetch lands, the next write must not send the version from before the DELETE.
      if (!data && input.version)
        queryClient.setQueryData<TaskView>(queryKeys.task(task.id!), (cached) => ({
          ...(cached ?? task),
          version: input.version,
        }))
      refresh(queryClient, data ?? task, input.otherTaskId, !data)
    },
  })
}

type AddInput = { otherTaskId: string; relation: DependencyRelation }
type RemoveInput = { dependencyId: string; otherTaskId: string }

/**
 * The Dependencies section's writes, one at a time (ClickUp 14yq6g33592): an add and a remove, or two
 * of either, never overlap, since the second would send the version the first is about to bump. A
 * write asked for while one is in flight is ignored (`null`). The flag is a ref, so two clicks in one
 * tick both see it, and it lives with the section, so closing and reopening the picker keeps it.
 */
export function useDependencyWrites(task: TaskView) {
  const add = useAddDependency(task)
  const remove = useRemoveDependency(task)
  const busy = useRef(false)
  function once<T>(run: () => Promise<T>): Promise<T> | null {
    if (busy.current) return null
    busy.current = true
    return run().finally(() => {
      busy.current = false
    })
  }
  return {
    pending: add.isPending || remove.isPending,
    add: (input: AddInput) => once(() => add.mutateAsync(input)),
    // A failed removal puts its row back with a toast (onError); nothing else to report.
    remove: (input: RemoveInput) => once(() => remove.mutateAsync(input).then(noop, noop)),
  }
}

export type DependencyWrites = ReturnType<typeof useDependencyWrites>

function noop() {}
