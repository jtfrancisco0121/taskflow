import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import { clearSession } from '../../api/session'

/** FR-3: ends the session on the server, drops the token and every cached entity. */
export function useSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    try {
      await api.POST('/api/v1/auth/signout')
    } catch {
      // The local session ends even when the server cannot be reached.
    }
    clearSession()
    queryClient.clear()
    void navigate('/signin', { replace: true })
  }
}
