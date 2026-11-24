import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** Tasks under a Location (a List, or every List nested in a Folder or Space), 50 per page. */
export function useTasks(workspaceId: string, locationId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.tasks(workspaceId, locationId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/tasks', {
          params: { query: { locationId, workspaceId, limit: 50, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}
