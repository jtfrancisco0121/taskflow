import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'

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

  it('looks up the global fetch lazily', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost' })
    const fetchStub = vi.fn(async () => metaResponse())
    vi.stubGlobal('fetch', fetchStub)

    await client.GET('/api/v1/meta')

    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
