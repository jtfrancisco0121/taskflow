import { QueryClient } from '@tanstack/react-query'
import { onSessionEnd } from '../api/session'

export const queryClient = new QueryClient()

// A failed refresh or a change of user must never leave another user's cache behind.
onSessionEnd(() => queryClient.clear())
