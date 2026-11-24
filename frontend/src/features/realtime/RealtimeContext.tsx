import { createContext, useContext } from 'react'
import type { RealtimeClient } from './stompClient'

export const RealtimeContext = createContext<RealtimeClient | null>(null)

export function useRealtime(): RealtimeClient | null {
  return useContext(RealtimeContext)
}
