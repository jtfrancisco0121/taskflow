import { beforeEach, describe, expect, it, vi } from 'vitest'

type Config = {
  brokerURL: string
  beforeConnect: () => Promise<void>
  onConnect: () => void
  connectHeaders?: Record<string, string>
  reconnectDelay: number
}

const created: Array<{
  config: Config
  connected: boolean
  subscribe: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
}> = []

vi.mock('@stomp/stompjs', () => ({
  Client: class {
    connected = false
    connectHeaders: Record<string, string> = {}
    reconnectDelay = 0
    subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
    publish = vi.fn()
    activate = vi.fn()
    deactivate = vi.fn()
    constructor(public config: Config) {
      created.push(this as never)
      this.reconnectDelay = config.reconnectDelay
    }
  },
}))

import { createRealtimeClient, topicsFor } from './stompClient'

function makeClient() {
  const client = createRealtimeClient({
    url: 'ws://localhost/ws',
    clientId: 'tab-1',
    token: async () => 'token-1',
  })
  const stomp = created.at(-1) as unknown as {
    config: Config
    connected: boolean
    connectHeaders: Record<string, string>
    subscribe: ReturnType<typeof vi.fn>
    publish: ReturnType<typeof vi.fn>
  }
  return { client, stomp }
}

describe('RT-1 realtime client', () => {
  beforeEach(() => (created.length = 0))

  it('CONNECT carries the bearer token and the tab’s X-Client-Id', async () => {
    const { stomp } = makeClient()
    await stomp.config.beforeConnect.call(stomp)
    expect(stomp.connectHeaders).toEqual({
      Authorization: 'Bearer token-1',
      'X-Client-Id': 'tab-1',
    })
    expect(stomp.config.brokerURL).toBe('ws://localhost/ws')
  })

  it('restores every subscription after a reconnect and fires onReconnect once per reconnect', () => {
    const { client, stomp } = makeClient()
    const hook = vi.fn()
    client.onReconnect(hook)
    const handler = vi.fn()
    client.subscribe('/topic/workspace/w1', handler) // before connecting: queued
    expect(stomp.subscribe).not.toHaveBeenCalled()

    stomp.connected = true
    stomp.config.onConnect.call(stomp)
    expect(stomp.subscribe).toHaveBeenCalledTimes(1)
    expect(hook).not.toHaveBeenCalled() // the first connect is not a reconnect

    stomp.config.onConnect.call(stomp) // the socket dropped and came back
    expect(stomp.subscribe).toHaveBeenCalledTimes(2)
    expect(hook).toHaveBeenCalledTimes(1)
    const callback = stomp.subscribe.mock.calls[0][1] as (m: { body: string }) => void
    callback({ body: '{"x":1}' })
    expect(handler).toHaveBeenCalledWith('{"x":1}')
  })

  it('send publishes only while connected and unsubscribe stops restoring', () => {
    const { client, stomp } = makeClient()
    client.send('/app/presence/t1')
    expect(stomp.publish).not.toHaveBeenCalled()
    stomp.connected = true
    client.send('/app/presence/t1')
    expect(stomp.publish).toHaveBeenCalledWith({ destination: '/app/presence/t1', body: '' })
    const off = client.subscribe('/topic/task/t1', vi.fn())
    off()
    stomp.config.onConnect.call(stomp)
    expect(stomp.subscribe).toHaveBeenCalledTimes(1) // only the one made before off()
  })

  it('a guest subscribes to its granted root Locations, never the Workspace topic', () => {
    const guest = topicsFor({
      workspaceId: 'w1',
      isGuest: true,
      guestRoots: ['s1', 'l2'],
      locationId: 'l2',
      taskId: 't9',
    })
    expect(guest).toEqual(['/topic/location/s1', '/topic/location/l2', '/topic/task/t9'])
    expect(guest.some((t) => t.includes('/workspace/'))).toBe(false)
    expect(topicsFor({ workspaceId: 'w1', isGuest: false, guestRoots: [] })).toEqual([
      '/topic/workspace/w1',
    ])
  })
})
