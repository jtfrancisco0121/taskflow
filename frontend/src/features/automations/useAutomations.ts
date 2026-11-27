import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import type { components } from '../../api/schema'
import type { RuleBody, RuleListView } from '../../api/types'

export type UpdateRuleBody = components['schemas']['UpdateRuleRequest']

export function useAutomations(locationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.automations(locationId ?? ''),
    enabled: !!locationId,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/locations/{id}/automations', { params: { path: { id: locationId! } } }),
      ),
  })
}

/**
 * A rule write changes the list of every location below it, so all lists are refreshed, a first load in flight
 * included: one that read before the write, or (the toggle) started after its onMutate cancel.
 */
function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    cancelThenInvalidate(queryClient, {
      predicate: (q) => q.queryKey[0] === 'location' && q.queryKey[2] === 'automations',
    })
}

export function useCreateAutomation(locationId: string) {
  const refresh = useRefresh()
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (body: RuleBody) =>
      unwrap(
        api.POST('/api/v1/locations/{id}/automations', {
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

export function useUpdateAutomation() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (vars: { id: string; version: number; body: UpdateRuleBody }) =>
      unwrap(
        api.PATCH('/api/v1/automations/{id}', {
          params: { path: { id: vars.id }, header: { 'If-Match': `"${vars.version}"` } },
          body: vars.body,
        }),
      ),
    onSuccess: refresh,
    // A stale write answers 409: show the fresh list either way.
    onError: refresh,
  })
}

/** The enable switch: optimistic, rolled back when the server refuses. */
export function useToggleAutomation(locationId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefresh()
  const key = queryKeys.automations(locationId)
  return useMutation({
    mutationFn: (vars: { id: string; version: number; enabled: boolean }) =>
      unwrap(
        api.PATCH('/api/v1/automations/{id}', {
          params: { path: { id: vars.id }, header: { 'If-Match': `"${vars.version}"` } },
          body: { enabled: vars.enabled },
        }),
      ),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<RuleListView>(key)
      if (previous) {
        queryClient.setQueryData<RuleListView>(key, {
          ...previous,
          rules: previous.rules?.map((r) =>
            r.id === vars.id ? { ...r, enabled: vars.enabled } : r,
          ),
        })
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: refresh,
  })
}

export function useDeleteAutomation() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      unwrap(
        api.DELETE('/api/v1/automations/{id}', {
          params: { path: { id: vars.id }, header: { 'If-Match': `"${vars.version}"` } },
        }),
      ),
    onSuccess: refresh,
    onError: refresh,
  })
}

/** The run history of a rule, newest first, paged with a keyset cursor (FR-12). */
export function useAutomationRuns(ruleId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.automationRuns(ruleId ?? ''),
    enabled: !!ruleId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/automations/{id}/runs', {
          params: { path: { id: ruleId! }, query: { cursor: pageParam, limit: 20 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}
