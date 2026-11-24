import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { useUiStore } from '../../shared/ui-store'
import { TreeItem } from './TreeItem'
import { useTreeChildren, type TreeNode } from './useTreeChildren'

/** FR-8 to FR-10: lazy ARIA tree of the Workspace's Spaces, Folders and Lists. */
export function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const root = useTreeChildren(workspaceId, 'root', true)
  const expanded = useUiStore((state) => state.expanded[workspaceId])
  const loadExpanded = useUiStore((state) => state.loadExpanded)
  const dropExpanded = useUiStore((state) => state.dropExpanded)
  const fetching = useIsFetching({ queryKey: queryKeys.treeAll(workspaceId) })
  const [focusedState, setFocused] = useState<string | null>(null)
  const items = root.data ?? []
  const focusedId = focusedState ?? items[0]?.id ?? null

  useEffect(() => {
    loadExpanded(workspaceId)
  }, [workspaceId, loadExpanded])

  // FR-9: once nothing is loading, forget expanded ids that no loaded node has (deleted or moved).
  useEffect(() => {
    if (!expanded?.length || !root.isSuccess) return
    const key = queryKeys.treeAll(workspaceId)
    if (queryClient.isFetching({ queryKey: key }) > 0) return
    const queries = queryClient.getQueryCache().findAll({ queryKey: key })
    if (queries.some((query) => query.state.status === 'error')) return
    const known = new Set(
      queries.flatMap((query) =>
        ((query.state.data as TreeNode[] | undefined) ?? []).map((node) => node.id),
      ),
    )
    const unknown = expanded.filter((id) => !known.has(id))
    if (unknown.length) dropExpanded(workspaceId, unknown)
  }, [expanded, fetching, root.isSuccess, workspaceId, queryClient, dropExpanded])

  if (root.isPending) {
    return (
      <p role="status" className="text-xs text-slate-500">
        Loading…
      </p>
    )
  }
  if (root.isError) {
    return (
      <p className="text-xs text-red-700">
        Couldn&apos;t load.{' '}
        <button type="button" className="underline" onClick={() => void root.refetch()}>
          Retry
        </button>
      </p>
    )
  }
  return (
    <ul role="tree" aria-label="Workspace tree" className="m-0 p-0">
      {items.map((node) => (
        <TreeItem
          key={node.id}
          workspaceId={workspaceId}
          node={node}
          level={1}
          focusedId={focusedId}
          onFocusItem={setFocused}
        />
      ))}
    </ul>
  )
}
