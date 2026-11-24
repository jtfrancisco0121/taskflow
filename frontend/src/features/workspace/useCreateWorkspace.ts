import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { IdempotencyKeys } from '../../api/idempotency'
import { queryKeys } from '../../api/queryKeys'

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      if (workspace.id) void navigate(`/w/${workspace.id}`)
    },
  })
}
