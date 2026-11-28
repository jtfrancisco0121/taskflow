import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { useUiStore } from '../../shared/ui-store'
import { Button } from '../../shared/ui/Button'
import { InlineNameField } from './InlineNameField'
import { TreeItem } from './TreeItem'
import { useCreateLocation } from './useLocationMutations'
import { useTreeChildren, type TreeNode } from './useTreeChildren'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

/** FR-8 to FR-10: lazy ARIA tree of the Workspace's Spaces, Folders and Lists. */
export function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const root = useTreeChildren(workspaceId, 'root', true)
  const expanded = useUiStore((state) => state.expanded[workspaceId])
  const loadExpanded = useUiStore((state) => state.loadExpanded)
  const dropExpanded = useUiStore((state) => state.dropExpanded)
  const creatingSpace = useUiStore((state) => state.creatingSpace)
  const setCreatingSpace = useUiStore((state) => state.setCreatingSpace)
  const createSpace = useCreateLocation(workspaceId)
  const fetching = useIsFetching({ queryKey: queryKeys.treeAll(workspaceId) })
  const [focusedState, setFocused] = useState<string | null>(null)
  const items = root.data ?? []
  const focusedId = focusedState ?? items[0]?.id ?? null

  useEffect(() => {
    loadExpanded(workspaceId)
  }, [workspaceId, loadExpanded])

  const loaded = hasData(root)
  // FR-9: once nothing is loading, forget expanded ids that no loaded node has (deleted or moved).
  useEffect(() => {
    if (!expanded?.length || !loaded) return
    const key = queryKeys.treeAll(workspaceId)
    if (queryClient.isFetching({ queryKey: key }) > 0) return
    const queries = queryClient.getQueryCache().findAll({ queryKey: key })
    // eslint-disable-next-line no-restricted-syntax -- cache entries, not a screen: skip pruning while any read failed
    if (queries.some((query) => query.state.status === 'error')) return
    const known = new Set(
      queries.flatMap((query) =>
        ((query.state.data as TreeNode[] | undefined) ?? []).map((node) => node.id),
      ),
    )
    const unknown = expanded.filter((id) => !known.has(id))
    if (unknown.length) dropExpanded(workspaceId, unknown)
  }, [expanded, fetching, loaded, workspaceId, queryClient, dropExpanded])

  if (root.isPending) {
    return (
      <p role="status" className="text-xs text-muted">
        Loading…
      </p>
    )
  }
  if (loadFailed(root)) {
    return (
      <p className="text-xs text-danger">
        Couldn&apos;t load.{' '}
        <button type="button" className="underline" onClick={() => void root.refetch()}>
          Retry
        </button>
      </p>
    )
  }
  return (
    <div>
      {refreshFailed(root) && (
        <p className="mb-2 text-xs text-muted">
          Couldn&apos;t refresh.{' '}
          <button type="button" className="underline" onClick={() => void root.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="mb-2">
        <Button
          className="w-full"
          onClick={() => {
            createSpace.reset()
            setCreatingSpace(true)
          }}
        >
          New Space
        </Button>
      </div>
      {creatingSpace && (
        <InlineNameField
          label="New Space name"
          withPrivate
          pending={createSpace.isPending}
          error={createSpace.error}
          onSave={(name, isPrivate) =>
            createSpace.mutate(
              { name, type: 'SPACE', isPrivate },
              { onSuccess: () => setCreatingSpace(false) },
            )
          }
          onCancel={() => setCreatingSpace(false)}
        />
      )}
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
    </div>
  )
}
