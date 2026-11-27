import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const keys = useRef(new IdempotencyKeys())
  return useMutation({
    mutationFn: (body: { name: string; key?: string }) =>
      unwrap(
        api.POST('/api/v1/workspaces', {
          body,
          headers: { 'Idempotency-Key': keys.current.keyFor(body) },
        }),
      ),
    onSuccess: async (workspace) => {
      keys.current.done()
      // A workspaces list still on its first load read before this write: restart it, not just invalidate.
      await cancelThenInvalidate(queryClient, { queryKey: queryKeys.workspaces() })
      if (workspace.id) void navigate(`/w/${workspace.id}`)
    },
  })
}
