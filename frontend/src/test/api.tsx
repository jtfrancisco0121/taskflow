import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { testFetch } from './fetch-ref'

export type StubHandler = (request: Request, body: unknown) => Response | Promise<Response>

type Route = { method: string; pattern: RegExp; handler: StubHandler }

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function problem(status: number, code: string, detail: string, extra = {}): Response {
  return new Response(JSON.stringify({ title: detail, status, detail, code, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

/**
 * A stub fetch with route matching. `routes` keys look like `GET /api/v1/tasks/:id`; `:name`
 * matches one path segment (the query string is ignored by the pattern). Every request seen is in
 * `calls`, with its parsed JSON body. An unmatched request answers 404 and is recorded.
 */
export function stubFetch(routes: Record<string, StubHandler | Response | object> = {}) {
  const table: Route[] = []
  const calls: { method: string; url: URL; headers: Headers; body: unknown }[] = []
  const add = (key: string, handler: StubHandler | Response | object) => {
    const [method, path] = key.split(' ')
    const pattern = new RegExp(`^${path.replace(/:[a-zA-Z]+/g, '[^/]+')}$`)
    const fn: StubHandler =
      typeof handler === 'function'
        ? (handler as StubHandler)
        : handler instanceof Response
          ? () => handler.clone()
          : () => json(handler)
    table.push({ method, pattern, handler: fn })
  }
  Object.entries(routes).forEach(([key, handler]) => add(key, handler))

  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    let body: unknown = undefined
    const raw = request.method === 'GET' ? '' : await request.clone().text()
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    calls.push({ method: request.method, url, headers: request.headers, body })
    // Later registrations win, so a test can override a default route.
    const route = [...table]
      .reverse()
      .find((r) => r.method === request.method && r.pattern.test(url.pathname))
    if (!route) return problem(404, 'request.404', `No stub for ${request.method} ${url.pathname}`)
    return route.handler(request, body)
  })
  return Object.assign(fetch, {
    calls,
    add,
    count: (method: string, pathPattern: RegExp) =>
      calls.filter((c) => c.method === method && pathPattern.test(c.url.pathname)).length,
  })
}

/** Installs a stub as the fetch behind the test `api` client (AD-12). */
export function useStubFetch(routes: Record<string, StubHandler | Response | object> = {}) {
  const stub = stubFetch(routes)
  testFetch.current = stub
  return stub
}

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; state?: object; queryClient?: QueryClient } = {},
) {
  const queryClient = options.queryClient ?? newQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: options.route ?? '/', state: options.state }]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}
