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

/**
 * Sends once, and once more after the capped Retry-After when the answer is busy. An abort of `signal` during the wait
 * (the screen that asked went away, ClickUp 14yq6g334bn) sends nothing more and answers with the busy result.
 */
export async function onceMoreIfBusy<R extends { response: Response; error?: unknown }>(
  send: () => Promise<R>,
  signal?: AbortSignal,
): Promise<R> {
  const first = await send()
  if (!isBusy(first.response, first.error) || signal?.aborted) return first
  await sleep(retryWaitMs(first.response), signal)
  return signal?.aborted ? first : send()
}

/** Waits `ms`, or less: an abort of `signal` ends the wait at once and clears its timer. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
