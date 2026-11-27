import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { clearSession, setSession } from '../../api/session'
import { installFetch, renderWithProviders } from '../../test/api'
import { LiveUpdates } from './LiveUpdates'

const fake = vi.hoisted(() => ({ reconnect: undefined as undefined | (() => void) }))

vi.mock('./stompClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stompClient')>()),
  createRealtimeClient: () => ({
    subscribe: () => () => {},
    send: () => {},
    onReconnect: (fn: () => void) => {
      fake.reconnect = fn
      return () => {}
    },
    activate: () => {},
    deactivate: async () => {},
    connected: true,
  }),
}))

describe('LiveUpdates reconnect', () => {
  beforeEach(() => {
    fake.reconnect = undefined
    clearSession()
    setSession('token', { id: 'u1', email: 'a@b.c', displayName: 'Maya Lopez' } as never)
    installFetch({
      'GET /api/v1/workspaces/:id/members': {
        items: [{ userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' }],
      },
    })
  })

  it('refetches a view still on its first load once that load lands (it may predate missed messages)', async () => {
    let reads = 0
    let missed = false
    let release: () => void = () => {}
    const opened = new Promise<void>((resolve) => (release = resolve))
    function Probe() {
      const { data } = useQuery({
        queryKey: queryKeys.view('w1', 'l1', 'h'),
        queryFn: async () => {
          reads += 1
          const seen = missed
          if (reads === 1) await opened
          return seen ? 'after' : 'before'
        },
      })
      return <p>{data ?? 'loading'}</p>
    }
    renderWithProviders(
      <LiveUpdates workspaceId="w1">
        <Probe />
      </LiveUpdates>,
    )
    await waitFor(() => expect(fake.reconnect).toBeDefined())
    expect(reads).toBe(1)
    missed = true // a message was missed while the socket was down
    act(() => fake.reconnect!())
    release()
    await screen.findByText('after')
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    expect(reads).toBe(2)
  })
})
