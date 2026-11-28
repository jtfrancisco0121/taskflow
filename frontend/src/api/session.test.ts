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

  describe('14yq6g334r6: a busy server (503) never signs the user out', () => {
    const base = 'http://localhost'
    const busy = (retryAfter?: string) =>
      new Response('{}', {
        status: 503,
        headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
      })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('retries once after Retry-After and keeps the session when the retry succeeds', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fetchStub = vi
        .fn<(request: Request) => Promise<Response>>()
        .mockResolvedValueOnce(busy('1'))
        .mockResolvedValueOnce(authResponse('t2'))

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      expect(await pending).toBe('t2')
      expect(fetchStub).toHaveBeenCalledTimes(2)
      expect(getAccessToken()).toBe('t2')
    })

    it('keeps the session when the one retry is busy too, and does not retry again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fetchStub = vi.fn(async () => busy('1'))

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await pending).toBeNull()
      expect(fetchStub).toHaveBeenCalledTimes(2)
      expect(getAccessToken()).toBe('old')
    })

    it('caps a long Retry-After at 5 s', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fetchStub = vi
        .fn<(request: Request) => Promise<Response>>()
        .mockResolvedValueOnce(busy('3600'))
        .mockResolvedValueOnce(authResponse('t2'))

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      expect(await pending).toBe('t2')
    })

    it('waits 1 s when Retry-After is missing', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      const fetchStub = vi
        .fn<(request: Request) => Promise<Response>>()
        .mockResolvedValueOnce(busy())
        .mockResolvedValueOnce(authResponse('t2'))

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      expect(await pending).toBe('t2')
    })

    it('only a 401 clears the session: a 500 or a network error keeps it', async () => {
      setSession('old', { id: 'u1' })
      expect(
        await refreshSession({
          fetch: async () => new Response('{}', { status: 500 }),
          baseUrl: base,
        }),
      ).toBeNull()
      expect(getAccessToken()).toBe('old')

      expect(
        await refreshSession({
          fetch: async () => {
            throw new TypeError('network down')
          },
          baseUrl: base,
        }),
      ).toBeNull()
      expect(getAccessToken()).toBe('old')
    })
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
