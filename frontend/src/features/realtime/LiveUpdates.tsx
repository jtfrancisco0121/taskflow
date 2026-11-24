import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { clientId } from '../../api/clientId'
import { getAccessToken, getSessionUser, refreshSession } from '../../api/session'
import { queryKeys } from '../../api/queryKeys'
import { useTreeChildren } from '../locations'
import { useMembers } from '../workspace'
import { createCachePatcher } from './cachePatcher'
import { RealtimeContext } from './RealtimeContext'
import { createRealtimeClient, topicsFor, type LiveEvent, type RealtimeClient } from './stompClient'

const wsUrl = () =>
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

/**
 * One STOMP connection per tab while signed in. It subscribes to the open Workspace (or, for a
 * guest, to the granted top-level Locations), the open Location and the open task; Live messages
 * patch the query caches, and a polite live region announces them without moving focus.
 */
export function LiveUpdates({
  workspaceId,
  locationId,
  taskId,
  children,
}: {
  workspaceId: string | undefined
  locationId?: string
  taskId?: string
  children?: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [announcement, setAnnouncement] = useState('')
  const client = useMemo<RealtimeClient>(
    () =>
      createRealtimeClient({
        url: wsUrl(),
        clientId,
        token: async () => getAccessToken() ?? (await refreshSession()),
      }),
    [],
  )
  useEffect(() => {
    client.activate()
    return () => void client.deactivate()
  }, [client])

  const patcher = useMemo(
    () => createCachePatcher(queryClient, { clientId, announce: setAnnouncement }),
    [queryClient],
  )
  useEffect(() => () => patcher.dispose(), [patcher])

  const { members } = useMembers(workspaceId)
  const me = getSessionUser()?.id
  const role = members.find((m) => m.userId === me)?.role
  const isGuest = role === 'GUEST'
  // The same hook (and cache shape) as the sidebar: a guest's top-level Locations are its grants.
  const roots = useTreeChildren(workspaceId ?? '', 'root', !!workspaceId && isGuest)
  const guestRoots = (roots.data ?? []).map((n) => n.id!).sort()
  const topicKey =
    workspaceId && role
      ? topicsFor({ workspaceId, isGuest, guestRoots, locationId, taskId }).join(',')
      : ''

  useEffect(() => {
    if (!client || !workspaceId || !topicKey) return
    const off = topicKey.split(',').map((topic) =>
      client.subscribe(topic, (body) => {
        try {
          const event = JSON.parse(body) as LiveEvent
          void patcher.handle(workspaceId, event)
        } catch {
          // a malformed message is ignored
        }
      }),
    )
    // After a reconnect the open views are refetched once (messages may have been missed).
    const offReconnect = client.onReconnect(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.treeAll(workspaceId) })
    })
    return () => {
      off.forEach((fn) => fn())
      offReconnect()
    }
  }, [client, workspaceId, topicKey, patcher, queryClient])

  return (
    <RealtimeContext.Provider value={client}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </RealtimeContext.Provider>
  )
}
