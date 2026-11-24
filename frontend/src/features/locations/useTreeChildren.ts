import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { components } from '../../api/schema'

export type TreeNode = components['schemas']['TreeNode']

/**
 * Children of one tree node (or the Spaces for 'root'). The endpoint takes no cursor (it returns
 * every visible child in one page), so this is a plain query, enabled only when the node is open.
 */
export function useTreeChildren(workspaceId: string, parentId: string | 'root', enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tree(workspaceId, parentId),
    enabled,
    staleTime: 60_000, // writes invalidate the affected parents explicitly (AD-13)
    queryFn: async () => {
      const page = await unwrap(
        api.GET('/api/v1/workspaces/{id}/tree', {
          params: {
            path: { id: workspaceId },
            query: parentId === 'root' ? {} : { parentId },
          },
        }),
      )
      return page.items ?? []
    },
  })
}
