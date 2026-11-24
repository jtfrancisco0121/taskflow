import createClient from 'openapi-fetch'
import { clearSession, getAccessToken, refreshSession } from './session'
import type { paths } from './schema'

type Fetcher = (request: Request) => Promise<Response>

type ApiClientOptions = {
  baseUrl?: string
  fetch?: Fetcher
}

/**
 * The only place that talks HTTP (AD-1). The app uses a relative base URL so the browser always
 * goes through the Vite /api proxy; tests pass an absolute origin and a stub fetch.
 * `fetch` is looked up at call time, not at import time.
 *
 * The auth middleware lives here (not on the singleton) so a test client gets it too: it adds the
 * bearer token and, on a 401 from a non-auth path, retries once after one shared refresh.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const send: Fetcher = options.fetch ?? ((request) => globalThis.fetch(request))
  const refresh = () => refreshSession({ fetch: send, baseUrl: options.baseUrl })
  const client = createClient<paths>({ baseUrl: options.baseUrl ?? '', fetch: send })
  // A body can be read only once, so keep a clone and the token each request was sent with.
  const sent = new WeakMap<Request, { clone: Request; token: string | null }>()

  client.use({
    onRequest({ request }) {
      const token = getAccessToken()
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      sent.set(request, { clone: request.clone(), token })
    },
    async onResponse({ request, response }) {
      if (response.status !== 401) return undefined
      if (new URL(request.url, 'http://localhost').pathname.startsWith('/api/v1/auth/')) {
        return undefined
      }
      const record = sent.get(request)
      if (!record) return undefined
      const current = getAccessToken()
      // Another call already refreshed: retry with the current token, no second refresh.
      const token = current && current !== record.token ? current : await refresh()
      if (!token) {
        clearSession()
        return undefined
      }
      const retry = new Request(record.clone)
      retry.headers.set('Authorization', `Bearer ${token}`)
      return send(retry)
    },
  })
  // The app boot calls api.refresh() so it goes through the same fetch as every other request.
  return Object.assign(client, { refresh })
}

export const api = createApiClient()
