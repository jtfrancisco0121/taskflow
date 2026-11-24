import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** AD-12: the effective fields of a location, plus its own hides. Key under ['location', id]. */
export function useLocationFields(locationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fields(locationId ?? ''),
    enabled: !!locationId,
    queryFn: () =>
      unwrap(api.GET('/api/v1/locations/{id}/fields', { params: { path: { id: locationId! } } })),
  })
}
