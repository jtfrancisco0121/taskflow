import {
  useMutation,
  useQuery,
  useQueryClient,
  type InvalidateQueryFilters,
  type QueryClient,
} from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { ApiError, messageOf, networkError, toApiError, unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, firstLoadsOf, inBackground, restartQueries } from '../../api/refresh'
import type { DependencyList, DependencyRelation, TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'

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
function refresh(queryClient: QueryClient, task: TaskView, otherId: string | undefined) {
  // The acting task goes into its detail; one still on its first load read before this write, so it restarts.
  writeCurrent(queryClient, task.id!, task)
  const filters: InvalidateQueryFilters[] = []
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
  const firstLoad = firstLoadsOf(queryClient, { queryKey: queryKeys.task(id), exact: true })
  queryClient.setQueryData(queryKeys.task(id), current)
  inBackground(restartQueries(queryClient, firstLoad))
}

/** Adds a relationship from `task`'s side (POST, If-Match, one idempotency key per submission). */
export function useAddDependency(task: TaskView) {
  const queryClient = useQueryClient()
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: async (input: { otherTaskId: string; relation: DependencyRelation }) => {
      const cached = queryClient.getQueryData<TaskView>(queryKeys.task(task.id!)) ?? task
      let result
      try {
        result = await api.POST('/api/v1/tasks/{id}/dependencies', {
          params: { path: { id: task.id! }, header: ifMatch(cached.version) },
          body: input,
          headers: { 'Idempotency-Key': keys.current.keyFor(input) },
        })
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
  return useMutation({
    mutationFn: async (input: { dependencyId: string; otherTaskId: string }) => {
      const cached = queryClient.getQueryData<TaskView>(queryKeys.task(task.id!)) ?? task
      let result
      try {
        result = await api.DELETE('/api/v1/tasks/{id}/dependencies/{dependencyId}', {
          params: {
            path: { id: task.id!, dependencyId: input.dependencyId },
            header: ifMatch(cached.version),
          },
        })
      } catch {
        throw networkError()
      }
      if (!result.response.ok) throw toApiError(result.response, result.error)
      return input
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
      }
      const stale = error instanceof ApiError && error.code === 'task.version_conflict'
      if (stale) {
        const current = (error.body as { current?: TaskView } | undefined)?.current
        if (current) writeCurrent(queryClient, task.id!, current)
      }
      useToastStore
        .getState()
        .show(stale ? 'This task changed. Try again.' : messageOf(error), 'error')
    },
    onSuccess: async (input) => {
      const fresh = await unwrap(
        api.GET('/api/v1/tasks/{id}', { params: { path: { id: task.id! } } }),
      )
      refresh(queryClient, fresh, input.otherTaskId)
    },
  })
}
