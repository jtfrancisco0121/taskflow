import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** AD-9: a task's status is resolved from the effective set of its home List. */
export function useLocationStatuses(
  workspaceId: string | undefined,
  locationId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.statuses(workspaceId ?? '', locationId ?? ''),
    enabled: !!workspaceId && !!locationId,
    queryFn: () =>
      unwrap(api.GET('/api/v1/locations/{id}/statuses', { params: { path: { id: locationId! } } })),
  })
}
