import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** One Location (name, type, parent, privacy): the List view header and the statuses dialog. */
export function useLocationInfo(locationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.location(locationId ?? ''),
    enabled: !!locationId,
    queryFn: () =>
      unwrap(api.GET('/api/v1/locations/{id}', { params: { path: { id: locationId! } } })),
  })
}
