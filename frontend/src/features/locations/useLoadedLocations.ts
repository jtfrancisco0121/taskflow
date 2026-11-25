import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import type { TreeNode } from './useTreeChildren'

/**
 * Every Location the sidebar tree has loaded so far, read from the query cache (no request of its own).
 * A Location appears once its parent has been opened in the tree.
 */
export function useLoadedLocations(workspaceId: string | undefined): TreeNode[] {
  const queryClient = useQueryClient()
  const [nodes, setNodes] = useState<TreeNode[]>([])
  useEffect(() => {
    if (!workspaceId) return
    const key = queryKeys.treeAll(workspaceId)
    const read = () => {
      const found = queryClient
        .getQueryCache()
        .findAll({ queryKey: key })
        .flatMap((query) => (query.state.data as TreeNode[] | undefined) ?? [])
      setNodes((previous) =>
        previous.length === found.length && previous.every((node, i) => node === found[i])
          ? previous
          : found,
      )
    }
    read()
    let live = true
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      // Defer: the cache notifies synchronously while another component renders.
      queueMicrotask(() => {
        if (live) read()
      })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [workspaceId, queryClient])
  return workspaceId ? nodes : []
}
