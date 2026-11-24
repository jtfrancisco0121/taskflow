import { Client, type StompSubscription } from '@stomp/stompjs'

export type LiveEvent = {
  type: string
  entity: string
  entityId: string
  version?: number | null
  listId?: string | null
  clientId?: string | null
  occurredAt?: string
}

type Options = {
  url: string
  clientId: string
  /** The current access token, refreshed first when there is none (single-flight upstream). */
  token: () => Promise<string | null>
  /** Delay before the first retry; doubled up to `maxDelayMs` while the server stays away. */
  baseDelayMs?: number
  maxDelayMs?: number
}

type Sub = { destination: string; handler: (body: string) => void; live?: StompSubscription }

/**
 * AD-13, AD-17: a STOMP client over native WebSocket. CONNECT carries the bearer token and the
 * tab's X-Client-Id; reconnects back off and fetch a fresh token (the server closes the socket at
 * the token's expiry); every subscription is restored after a reconnect and `onReconnect` fires,
 * so open views refetch once.
 */
export function createRealtimeClient(options: Options) {
  const subs = new Set<Sub>()
  const reconnectHooks = new Set<() => void>()
  let delay = options.baseDelayMs ?? 1000
  let connectedOnce = false

  const client = new Client({
    brokerURL: options.url,
    reconnectDelay: delay,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    beforeConnect: async () => {
      const token = await options.token()
      client.connectHeaders = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Client-Id': options.clientId,
      }
      client.reconnectDelay = delay
      delay = Math.min(options.maxDelayMs ?? 30000, delay * 2)
    },
    onConnect: () => {
      delay = options.baseDelayMs ?? 1000
      subs.forEach(attach)
      if (connectedOnce) reconnectHooks.forEach((hook) => hook())
      connectedOnce = true
    },
  })

  function attach(sub: Sub) {
    if (!client.connected) return
    sub.live = client.subscribe(sub.destination, (message) => sub.handler(message.body))
  }

  return {
    activate: () => client.activate(),
    deactivate: () => client.deactivate(),
    /** Subscribes now or when the connection is up; the returned function unsubscribes. */
    subscribe(destination: string, handler: (body: string) => void): () => void {
      const sub: Sub = { destination, handler }
      subs.add(sub)
      attach(sub)
      return () => {
        subs.delete(sub)
        try {
          sub.live?.unsubscribe()
        } catch {
          // the connection is already gone
        }
      }
    },
    send(destination: string, body = '') {
      if (client.connected) client.publish({ destination, body })
    },
    onReconnect(hook: () => void) {
      reconnectHooks.add(hook)
      return () => reconnectHooks.delete(hook)
    },
    get connected() {
      return client.connected
    },
  }
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>

/** The subscriptions of a user: guests never use the Workspace topic (AD-13). */
export function topicsFor(input: {
  workspaceId: string
  isGuest: boolean
  /** Top-level Locations a guest was granted (the roots of the guest's tree). */
  guestRoots: string[]
  locationId?: string
  taskId?: string
}): string[] {
  const topics = new Set<string>()
  if (input.isGuest) input.guestRoots.forEach((id) => topics.add(`/topic/location/${id}`))
  else topics.add(`/topic/workspace/${input.workspaceId}`)
  if (input.locationId) topics.add(`/topic/location/${input.locationId}`)
  if (input.taskId) topics.add(`/topic/task/${input.taskId}`)
  return [...topics]
}
