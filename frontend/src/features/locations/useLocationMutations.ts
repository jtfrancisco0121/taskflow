import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import { useUiStore } from '../../shared/ui-store'
import type { TreeNode } from './useTreeChildren'

type LocationType = 'SPACE' | 'FOLDER' | 'LIST'

/**
 * AD-13: a create invalidates the tree (the parent's children, and its own `hasChildren` flag in
 * the grandparent's list, so the whole Workspace tree is marked stale; only open nodes refetch).
 */
export function useCreateLocation(workspaceId: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setExpanded = useUiStore((state) => state.setExpanded)
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (vars: {
      name: string
      type: LocationType
      parentId?: string
      isPrivate?: boolean
    }) => {
      const body = {
        workspaceId,
        name: vars.name,
        type: vars.type,
        ...(vars.parentId ? { parentId: vars.parentId } : {}),
        ...(vars.isPrivate ? { isPrivate: true } : {}),
      }
      return unwrap(
        api.POST('/api/v1/locations', {
          body,
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      )
    },
    onSuccess: async (location, vars) => {
      keys.current.done()
      if (vars.parentId) setExpanded(workspaceId, vars.parentId, true)
      // A new Folder opens at once so its auto-created first List shows under it.
      if (vars.type === 'FOLDER' && location.id) setExpanded(workspaceId, location.id, true)
      await queryClient.invalidateQueries({ queryKey: queryKeys.treeAll(workspaceId) })
      if (location.id) void navigate(`/w/${workspaceId}/l/${location.id}`)
    },
  })
}

/** Rename or privacy change: the response is written into the parent's tree list and the location. */
export function useUpdateLocation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; parentId?: string; name?: string; isPrivate?: boolean }) =>
      unwrap(
        api.PATCH('/api/v1/locations/{id}', {
          params: { path: { id: vars.id } },
          body: {
            ...(vars.name !== undefined ? { name: vars.name } : {}),
            ...(vars.isPrivate !== undefined ? { isPrivate: vars.isPrivate } : {}),
          },
        }),
      ),
    onSuccess: (location, vars) => {
      queryClient.setQueryData<TreeNode[]>(
        queryKeys.tree(workspaceId, vars.parentId ?? 'root'),
        (nodes) =>
          nodes?.map((node) =>
            node.id === vars.id
              ? { ...node, name: location.name, isPrivate: location.isPrivate }
              : node,
          ),
      )
      queryClient.setQueryData(queryKeys.location(vars.id), location)
    },
  })
}

/** Move: both old and new parents refresh, plus the location and every task list (paths changed). */
export function useMoveLocation(workspaceId: string) {
  const queryClient = useQueryClient()
  const setExpanded = useUiStore((state) => state.setExpanded)
  return useMutation({
    mutationFn: (vars: { id: string; parentId: string; expand?: string[] }) =>
      unwrap(
        api.POST('/api/v1/locations/{id}/move', {
          params: { path: { id: vars.id } },
          body: { parentId: vars.parentId },
        }),
      ),
    onSuccess: async (_location, vars) => {
      // Open the new parent and its ancestors so the moved node is visible.
      for (const open of [...(vars.expand ?? []), vars.parentId])
        setExpanded(workspaceId, open, true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.treeAll(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.location(vars.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll(workspaceId) }),
      ])
    },
  })
}
