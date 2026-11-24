import createClient from 'openapi-fetch'
import type { paths } from './schema'

type ApiClientOptions = {
  baseUrl?: string
  fetch?: (request: Request) => Promise<Response>
}

/**
 * The only place that talks HTTP (AD-5). The app uses a relative base URL so the browser always
 * goes through the Vite /api proxy; tests pass an absolute origin and a stub fetch.
 * `fetch` is looked up at call time, not at import time.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    fetch: options.fetch ?? ((request) => globalThis.fetch(request)),
  })
}

export const api = createApiClient()
