/** Longest wait honoured from a 503's Retry-After, and the wait when it is missing or unreadable. */
export const MAX_RETRY_WAIT_MS = 5_000
export const DEFAULT_RETRY_WAIT_MS = 1_000

/** The wait a 503 asks for in its Retry-After (seconds), capped; the default when unreadable. */
export function retryWaitMs(response: Response): number {
  const header = response.headers.get('Retry-After')
  const seconds = header === null || header.trim() === '' ? NaN : Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_WAIT_MS
  return Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS)
}

/**
 * Lock contention on the server (ClickUp 14yq6g334u1): 503 request.busy, worth one retry. Takes
 * the parsed problem body, since openapi-fetch has already read the response.
 */
export function isBusy(response: Response, body: unknown): boolean {
  return (
    response.status === 503 &&
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === 'request.busy'
  )
}

/** Sends once, and once more after the capped Retry-After when the answer is busy. */
export async function onceMoreIfBusy<R extends { response: Response; error?: unknown }>(
  send: () => Promise<R>,
): Promise<R> {
  const first = await send()
  if (!isBusy(first.response, first.error)) return first
  await sleep(retryWaitMs(first.response))
  return send()
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
