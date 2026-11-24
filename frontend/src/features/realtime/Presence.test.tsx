import { screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSession, setSession } from '../../api/session'
import { installFetch, renderWithProviders } from '../../test/api'
import { Presence } from './Presence'
import { RealtimeContext } from './RealtimeContext'
import type { RealtimeClient } from './stompClient'

function fakeClient() {
  const unsub = vi.fn()
  let push: (body: string) => void = () => {}
  const client = {
    subscribe: vi.fn((destination: string, handler: (body: string) => void) => {
      push = handler
      return () => unsub(destination)
    }),
    send: vi.fn(),
    onReconnect: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    connected: true,
  } as unknown as RealtimeClient
  return { client, unsub, push: (body: string) => push(body) }
}

describe('RT-2 presence', () => {
  beforeEach(() => {
    clearSession()
    setSession('token', { id: 'u1', email: 'a@b.c', displayName: 'Maya Lopez' } as never)
    installFetch({
      'GET /api/v1/workspaces/:id/members': {
        items: [
          { userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' },
          { userId: 'u2', displayName: 'Omar Haddad', role: 'MEMBER' },
        ],
      },
    })
  })

  it('sends a heartbeat on open, shows the other viewer and leaves (unsubscribes) on close', async () => {
    const { client, unsub, push } = fakeClient()
    const { unmount } = renderWithProviders(
      <RealtimeContext.Provider value={client}>
        <Presence taskId="t1" workspaceId="w1" />
      </RealtimeContext.Provider>,
    )
    expect(client.subscribe).toHaveBeenCalledWith('/topic/task/t1/presence', expect.any(Function))
    expect(client.send).toHaveBeenCalledWith('/app/presence/t1')

    // names are known once the members arrive; the user's own entry is never shown
    await waitFor(() => expect(client.subscribe).toHaveBeenCalled())
    await act(async () => push(JSON.stringify({ taskId: 't1', viewers: ['u1', 'u2'] })))
    expect(await screen.findByText('Omar Haddad is viewing this')).toBeVisible()
    expect(screen.queryByText(/Maya Lopez is viewing/)).not.toBeInTheDocument()

    await act(async () => push(JSON.stringify({ taskId: 't1', viewers: ['u1'] })))
    await waitFor(() => expect(screen.queryByText(/is viewing this/)).not.toBeInTheDocument())

    unmount()
    expect(unsub).toHaveBeenCalledWith('/topic/task/t1/presence')
  })

  it('sends a heartbeat every 20 seconds', async () => {
    vi.useFakeTimers()
    const { client } = fakeClient()
    renderWithProviders(
      <RealtimeContext.Provider value={client}>
        <Presence taskId="t1" workspaceId="w1" />
      </RealtimeContext.Provider>,
    )
    expect(client.send).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(40_000)
    })
    expect(client.send).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})
