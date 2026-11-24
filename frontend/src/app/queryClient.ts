import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/errors'
import { onSessionEnd } from '../api/session'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry only what may be transient (network, 5xx); a 4xx answer will not change.
      retry: (failureCount, error) =>
        failureCount < 2 &&
        (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
  },
})

// A failed refresh or a change of user must never leave another user's cache behind.
onSessionEnd(() => queryClient.clear())
