import { useEffect, useRef } from 'react'
import { getSessionUser } from '../../api/session'
import { useRealtime } from './RealtimeContext'
import type { LiveEvent } from './stompClient'

/**
 * Subscribes the open tab to the signed-in person's own topic `/topic/user/{me}` on the existing
 * STOMP client (AD-18: never a second client). Only that person's notification events arrive there.
 * {@code onReconnect} fires after a reconnect, since messages may have been missed meanwhile.
 */
export function useUserTopic(handler: (event: LiveEvent) => void, onReconnect?: () => void) {
  const client = useRealtime()
  const me = getSessionUser()?.id
  const handlerRef = useRef(handler)
  const reconnectRef = useRef(onReconnect)
  useEffect(() => {
    handlerRef.current = handler
    reconnectRef.current = onReconnect
  })
  useEffect(() => {
    if (!client || !me) return
    const off = client.subscribe(`/topic/user/${me}`, (body) => {
      try {
        handlerRef.current(JSON.parse(body) as LiveEvent)
      } catch {
        // a malformed message is ignored
      }
    })
    const offReconnect = client.onReconnect(() => reconnectRef.current?.())
    return () => {
      off()
      offReconnect()
    }
  }, [client, me])
}
