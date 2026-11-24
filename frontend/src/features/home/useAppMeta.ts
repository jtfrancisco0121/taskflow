import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'

export function useAppMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/meta')
      if (error !== undefined || data === undefined) {
        throw new Error('Could not load backend info')
      }
      return data
    },
  })
}
