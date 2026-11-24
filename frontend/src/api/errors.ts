/** AD-7: every non-2xx response and network failure becomes one ApiError. */
export const GENERIC_ERROR = "Couldn't reach the server. Check your connection and try again."

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly title: string | undefined
  readonly detail: string | undefined
  readonly body: unknown

  constructor(init: {
    status: number
    code?: string
    title?: string
    detail?: string
    body?: unknown
  }) {
    super(init.detail ?? init.title ?? GENERIC_ERROR)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.body = init.body
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function toApiError(response: Response, body: unknown): ApiError {
  const problem = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return new ApiError({
    status: response.status,
    code: text(problem.code),
    title: text(problem.title),
    detail: text(problem.detail),
    body,
  })
}

export function networkError(): ApiError {
  return new ApiError({ status: 0 })
}

/** User-facing text: detail, then title, then the generic message. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return GENERIC_ERROR
    if (err.code?.startsWith('idempotency.')) return 'Still saving, try again.'
    return err.detail ?? err.title ?? GENERIC_ERROR
  }
  return GENERIC_ERROR
}

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Awaits an openapi-fetch call and returns its data, or throws ApiError. */
export async function unwrap<T>(call: PromiseLike<Result<T>>): Promise<T> {
  let result: Result<T>
  try {
    result = await call
  } catch {
    throw networkError()
  }
  if (!result.response.ok) throw toApiError(result.response, result.error)
  return result.data as T
}
