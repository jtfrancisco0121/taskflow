import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSession,
  getAccessToken,
  getSessionUser,
  MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES,
  onSessionEnd,
  refreshSession,
  setSession,
} from './session'

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

    it('a 500 or a network error is retried once and, the first time, keeps the session', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fiveHundred = vi.fn(async () => new Response('{}', { status: 500 }))
      let pending = refreshSession({ fetch: fiveHundred, baseUrl: base })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toBeNull()
      expect(fiveHundred).toHaveBeenCalledTimes(2)
      expect(getAccessToken()).toBe('old')

      const offline = vi.fn(async () => {
        throw new TypeError('network down')
      })
      pending = refreshSession({ fetch: offline, baseUrl: base })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toBeNull()
      expect(offline).toHaveBeenCalledTimes(2)
      expect(getAccessToken()).toBe('old')
    })
  })

  /**
   * PR #36 review: a refresh failure other than 401 kept the access token the server had just
   * rejected, so the user stayed "signed in" with a dead session. A definitive answer now clears it
   * at once; a transient one is retried and clears only after MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES
   * refreshes in a row end without a token.
   */
  describe('PR #36: a dead session ends, a transient failure does not end it early', () => {
    const base = 'http://localhost'
    const status = (code: number) => new Response('{}', { status: code })

    afterEach(() => {
      vi.useRealTimers()
      onSessionEnd(null)
    })

    async function refreshWith(fetchStub: (request: Request) => Promise<Response>) {
      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(10_000)
      return pending
    }

    it.each([400, 403, 404, 409, 422])(
      'a %i clears the session at once, with no retry',
      async (code) => {
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        setSession('dead', { id: 'u1' })
        const hook = vi.fn()
        onSessionEnd(hook)
        const fetchStub = vi.fn(async () => status(code))

        expect(await refreshWith(fetchStub)).toBeNull()
        expect(fetchStub).toHaveBeenCalledTimes(1)
        expect(getAccessToken()).toBeNull()
        expect(getSessionUser()).toBeNull()
        expect(hook).toHaveBeenCalledTimes(1)
      },
    )

    it.each([
      ['a 200 with no body', () => new Response(null, { status: 200 })],
      ['a 200 without accessToken', () => new Response('{}', { status: 200 })],
      ['a 204', () => new Response(null, { status: 204 })],
    ])('%s clears the session at once, with no retry', async (_name, answer) => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('dead', { id: 'u1' })
      const fetchStub = vi.fn(async () => answer())

      expect(await refreshWith(fetchStub)).toBeNull()
      expect(fetchStub).toHaveBeenCalledTimes(1)
      expect(getAccessToken()).toBeNull()
    })

    it.each([
      ['a 503', () => status(503)],
      ['a 500', () => status(500)],
      ['a 502', () => status(502)],
      ['a 429', () => status(429)],
      ['a 408', () => status(408)],
      [
        'a network error',
        () => {
          throw new TypeError('network down')
        },
      ],
    ])(
      '%s is transient: retried, and a good retry keeps the user signed in',
      async (_name, first) => {
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        setSession('old', { id: 'u1' })
        const hook = vi.fn()
        onSessionEnd(hook)
        const fetchStub = vi
          .fn<(request: Request) => Promise<Response>>()
          .mockImplementationOnce(async () => first())
          .mockResolvedValueOnce(authResponse('t2'))

        expect(await refreshWith(fetchStub)).toBe('t2')
        expect(fetchStub).toHaveBeenCalledTimes(2)
        expect(getAccessToken()).toBe('t2')
        expect(hook).not.toHaveBeenCalled()
      },
    )

    it('a definitive answer on the retry clears the session', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fetchStub = vi
        .fn<(request: Request) => Promise<Response>>()
        .mockResolvedValueOnce(status(503))
        .mockResolvedValueOnce(status(403))

      expect(await refreshWith(fetchStub)).toBeNull()
      expect(getAccessToken()).toBeNull()
    })

    it('transient failures keep the session until that many refreshes in a row fail, then clear it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const hook = vi.fn()
      onSessionEnd(hook)
      const busy = vi.fn(async () => status(503))

      for (let i = 1; i < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES; i++) {
        expect(await refreshWith(busy)).toBeNull()
        expect(getAccessToken()).toBe('old')
        expect(hook).not.toHaveBeenCalled()
      }
      expect(await refreshWith(busy)).toBeNull()
      expect(busy).toHaveBeenCalledTimes(2 * MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES)
      expect(getAccessToken()).toBeNull()
      expect(getSessionUser()).toBeNull()
      expect(hook).toHaveBeenCalledTimes(1)
    })

    it('a successful refresh resets the count of transient failures', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const busy = async () => status(503)
      for (let i = 1; i < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES; i++) await refreshWith(busy)
      expect(await refreshWith(async () => authResponse('t2'))).toBe('t2')
      for (let i = 1; i < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES; i++) {
        expect(await refreshWith(busy)).toBeNull()
      }
      expect(getAccessToken()).toBe('t2')
    })

    it('a new sign-in starts the count again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const busy = async () => status(503)
      for (let i = 1; i < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES; i++) await refreshWith(busy)
      setSession('signed-in-again', { id: 'u1' })
      for (let i = 1; i < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES; i++) await refreshWith(busy)
      expect(getAccessToken()).toBe('signed-in-again')
    })
  })

  describe('14yq6g3353g: a refresh that settles after sign-out does not sign the user back in', () => {
    const base = 'http://localhost'

    afterEach(() => {
      vi.useRealTimers()
    })

    it('a refresh waiting to retry when the user signs out stays signed out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      setSession('old', { id: 'u1' })
      const fetchStub = vi
        .fn<(request: Request) => Promise<Response>>()
        .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '1' } }))
        .mockResolvedValueOnce(authResponse('t2'))

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.advanceTimersByTimeAsync(10)
      clearSession() // useSignOut
      await vi.advanceTimersByTimeAsync(2_000)

      expect(await pending).toBeNull()
      expect(fetchStub).toHaveBeenCalledTimes(1) // no retry after sign-out
      expect(getAccessToken()).toBeNull()
      expect(getSessionUser()).toBeNull()
    })

    it('a refresh whose answer arrives after the user signed out stays signed out', async () => {
      setSession('old', { id: 'u1' })
      let answer: (response: Response) => void = () => {}
      const fetchStub = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve
          }),
      )

      const pending = refreshSession({ fetch: fetchStub, baseUrl: base })
      await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1))
      clearSession() // useSignOut
      answer(authResponse('t2'))

      expect(await pending).toBeNull()
      expect(getAccessToken()).toBeNull()
      expect(getSessionUser()).toBeNull()
    })

    it('a refresh that starts after sign-out still signs in', async () => {
      setSession('old', { id: 'u1' })
      clearSession()

      expect(await refreshSession({ fetch: async () => authResponse('t3'), baseUrl: base })).toBe(
        't3',
      )
      expect(getAccessToken()).toBe('t3')
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
