import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientId } from './clientId'
import { createApiClient } from './client'
import { clearSession, getAccessToken, onSessionEnd, setSession } from './session'

function metaResponse() {
  return new Response(JSON.stringify({ name: 'taskflow', version: '1.2.3' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends GET /api/v1/meta through the injected fetch', async () => {
    const fetchStub = vi.fn(async (request: Request) => {
      void request
      return metaResponse()
    })
    const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

    const { data } = await client.GET('/api/v1/meta')

    expect(data).toEqual({ name: 'taskflow', version: '1.2.3' })
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const request = fetchStub.mock.calls[0][0]
    expect(request.url).toBe('http://localhost/api/v1/meta')
    expect(request.method).toBe('GET')
  })

  it('RT-3 sends the per-tab X-Client-Id on every request', async () => {
    const fetchStub = vi.fn(async (request: Request) => {
      void request
      return metaResponse()
    })
    const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })
    await client.GET('/api/v1/meta')
    await client.GET('/api/v1/meta')
    for (const [request] of fetchStub.mock.calls) {
      expect(request.headers.get('X-Client-Id')).toBe(clientId)
    }
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('looks up the global fetch lazily', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost' })
    const fetchStub = vi.fn(async () => metaResponse())
    vi.stubGlobal('fetch', fetchStub)

    await client.GET('/api/v1/meta')

    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  describe('auth middleware', () => {
    afterEach(() => {
      clearSession()
      onSessionEnd(null)
    })

    const refreshOk = (token: string) =>
      new Response(JSON.stringify({ accessToken: token, user: { id: 'u1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    const ok = () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    /** A backend that accepts only the token `valid` and refreshes to it. */
    function backend(valid = 'new') {
      const seen: { path: string; auth: string | null; body: string }[] = []
      const fetchStub = vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname
        seen.push({
          path,
          auth: request.headers.get('Authorization'),
          body: await request.clone().text(),
        })
        if (path === '/api/v1/auth/refresh') return refreshOk(valid)
        return request.headers.get('Authorization') === `Bearer ${valid}`
          ? ok()
          : new Response('{}', { status: 401 })
      })
      return { fetchStub, seen }
    }

    it('FR-4: adds the bearer header', async () => {
      setSession('abc', { id: 'u1' })
      const { fetchStub, seen } = backend('abc')
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      await client.GET('/api/v1/workspaces')

      expect(seen[0].auth).toBe('Bearer abc')
    })

    it('FR-4: a 401 refreshes once and retries with the same body and the refreshed token', async () => {
      setSession('expired', { id: 'u1' })
      const { fetchStub, seen } = backend('new')
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      const { response } = await client.POST('/api/v1/workspaces', { body: { name: 'Acme' } })

      expect(response.status).toBe(200)
      const posts = seen.filter((r) => r.path === '/api/v1/workspaces')
      expect(posts).toHaveLength(2)
      expect(posts[0].auth).toBe('Bearer expired')
      expect(posts[1].auth).toBe('Bearer new')
      expect(posts[1].body).toBe(posts[0].body)
      expect(posts[1].body).toContain('Acme')
      expect(seen.filter((r) => r.path === '/api/v1/auth/refresh')).toHaveLength(1)
    })

    it('FR-4: two parallel 401s cause one refresh and each request is retried once', async () => {
      setSession('expired', { id: 'u1' })
      const { fetchStub, seen } = backend('new')
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      await Promise.all([client.GET('/api/v1/workspaces'), client.GET('/api/v1/me')])

      expect(seen.filter((r) => r.path === '/api/v1/auth/refresh')).toHaveLength(1)
      expect(seen.filter((r) => r.path === '/api/v1/workspaces')).toHaveLength(2)
      expect(seen.filter((r) => r.path === '/api/v1/me')).toHaveLength(2)
    })

    it('FR-4: a second 401 on the retry is final and does not loop', async () => {
      setSession('expired', { id: 'u1' })
      const fetchStub = vi.fn(async (request: Request) =>
        new URL(request.url).pathname === '/api/v1/auth/refresh'
          ? refreshOk('new')
          : new Response('{}', { status: 401 }),
      )
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      const { response } = await client.GET('/api/v1/workspaces')

      expect(response.status).toBe(401)
      expect(fetchStub).toHaveBeenCalledTimes(3) // request, refresh, retry
    })

    it('FR-4: a late 401 after a finished refresh retries with the current token, no second refresh', async () => {
      setSession('T1', { id: 'u1' })
      const seen: string[] = []
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const fetchStub = vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname
        const auth = request.headers.get('Authorization')
        seen.push(`${path} ${auth}`)
        if (path === '/api/v1/auth/refresh') return refreshOk('T2')
        if (path === '/api/v1/me' && auth === 'Bearer T1') {
          await gate // answered late
          return new Response('{}', { status: 401 })
        }
        return auth === 'Bearer T2' ? ok() : new Response('{}', { status: 401 })
      })
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      const late = client.GET('/api/v1/me') // sent with T1, held back
      await client.GET('/api/v1/workspaces') // 401 with T1, refresh to T2, retry
      release()
      const { response } = await late

      expect(response.status).toBe(200)
      expect(seen.filter((r) => r.startsWith('/api/v1/auth/refresh'))).toHaveLength(1)
      expect(seen).toContain('/api/v1/me Bearer T2')
    })

    it('FR-4: never retries /auth/* paths', async () => {
      const fetchStub = vi.fn(async () => new Response('{}', { status: 401 }))
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      const { response } = await client.POST('/api/v1/auth/signin', {
        body: { email: 'a@b.co', password: 'x' },
      })

      expect(response.status).toBe(401)
      expect(fetchStub).toHaveBeenCalledTimes(1)
    })

    it('FR-4: a failed refresh clears the session and runs the session-end hook', async () => {
      setSession('expired', { id: 'u1' })
      const hook = vi.fn()
      onSessionEnd(hook)
      const fetchStub = vi.fn(async () => new Response('{}', { status: 401 }))
      const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

      const { response } = await client.GET('/api/v1/workspaces')

      expect(response.status).toBe(401)
      expect(getAccessToken()).toBeNull()
      expect(hook).toHaveBeenCalled()
    })

    it('14yq6g334r6: a 401 whose refresh stays busy (503) keeps the session', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        setSession('stale', { id: 'u1' })
        const hook = vi.fn()
        onSessionEnd(hook)
        const fetchStub = vi.fn(async (request: Request) =>
          new URL(request.url).pathname === '/api/v1/auth/refresh'
            ? new Response('{}', { status: 503, headers: { 'Retry-After': '1' } })
            : new Response('{}', { status: 401 }),
        )
        const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub })

        const pending = client.GET('/api/v1/workspaces')
        await vi.advanceTimersByTimeAsync(5_000)
        const { response } = await pending

        expect(response.status).toBe(401)
        expect(getAccessToken()).toBe('stale')
        expect(hook).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
