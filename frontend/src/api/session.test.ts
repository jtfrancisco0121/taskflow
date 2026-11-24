import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSession, getAccessToken, refreshSession, setSession } from './session'

function authResponse(token: string) {
  return new Response(
    JSON.stringify({ accessToken: token, user: { id: 'u1', displayName: 'Maya' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('session', () => {
  afterEach(() => clearSession())

  it('FR-4: two concurrent refreshSession() calls send one request', async () => {
    const fetchStub = vi.fn(async (request: Request) => {
      void request
      await new Promise((resolve) => setTimeout(resolve, 5))
      return authResponse('t1')
    })

    const [a, b] = await Promise.all([
      refreshSession({ fetch: fetchStub, baseUrl: 'http://localhost' }),
      refreshSession({ fetch: fetchStub, baseUrl: 'http://localhost' }),
    ])

    expect(a).toBe('t1')
    expect(b).toBe('t1')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls[0][0].url).toContain('/api/v1/auth/refresh')
    expect(getAccessToken()).toBe('t1')
  })

  it('FR-4: a refresh refused by the server clears the session', async () => {
    setSession('old', { id: 'u1' })
    const fetchStub = vi.fn(async () => new Response('{}', { status: 401 }))

    expect(await refreshSession({ fetch: fetchStub, baseUrl: 'http://localhost' })).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('NFR-2: the token is never written to localStorage, sessionStorage or a cookie', async () => {
    await refreshSession({
      fetch: async () => authResponse('secret-token'),
      baseUrl: 'http://localhost',
    })
    setSession('another-secret', { id: 'u1' })

    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(dump).not.toContain('secret')
    expect(document.cookie).not.toContain('secret')
  })

  it('runs the session-end hook when the session is cleared or the user changes', async () => {
    const { onSessionEnd } = await import('./session')
    const hook = vi.fn()
    onSessionEnd(hook)
    setSession('t1', { id: 'u1' })
    setSession('t2', { id: 'u2' })
    expect(hook).toHaveBeenCalledTimes(1)
    clearSession()
    expect(hook).toHaveBeenCalledTimes(2)
    onSessionEnd(null)
  })
})
