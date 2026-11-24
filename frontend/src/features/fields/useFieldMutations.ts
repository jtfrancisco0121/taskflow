import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'

export type CreateFieldBody = components['schemas']['CreateFieldRequest']
export type UpdateFieldBody = components['schemas']['UpdateFieldRequest']

/** A definition change refreshes every field list, task and view of the Workspace. */
function useRefresh(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'location' && q.queryKey[2] === 'fields',
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.taskAll() }),
    ])
}

export function useCreateField(workspaceId: string, locationId: string) {
  const refresh = useRefresh(workspaceId)
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (body: CreateFieldBody) =>
      unwrap(
        api.POST('/api/v1/locations/{id}/fields', {
          params: { path: { id: locationId } },
          body,
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      ),
    onSuccess: () => {
      keys.current.done()
      return refresh()
    },
  })
}

export function useUpdateField(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (vars: { id: string; version: number; body: UpdateFieldBody }) =>
      unwrap(
        api.PATCH('/api/v1/fields/{id}', {
          params: { path: { id: vars.id }, header: { 'If-Match': `"${vars.version}"` } },
          body: vars.body,
        }),
      ),
    onSuccess: refresh,
    // A stale write answers 409 with the current field: show the fresh list either way.
    onError: refresh,
  })
}

export function useRetireField(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      unwrap(
        api.DELETE('/api/v1/fields/{id}', {
          params: { path: { id: vars.id }, header: { 'If-Match': `"${vars.version}"` } },
        }),
      ),
    onSuccess: refresh,
    onError: refresh,
  })
}

export function useHideField(workspaceId: string, locationId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (vars: { fieldId: string; hidden: boolean }) => {
      const params = { params: { path: { id: locationId, fieldId: vars.fieldId } } }
      return unwrap(
        vars.hidden
          ? api.PUT('/api/v1/locations/{id}/fields/{fieldId}/hidden', params)
          : api.DELETE('/api/v1/locations/{id}/fields/{fieldId}/hidden', params),
      )
    },
    onSuccess: refresh,
  })
}
