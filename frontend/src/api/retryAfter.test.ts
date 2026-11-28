// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onceMoreIfBusy, sleep } from './retryAfter'

const busy = () => ({
  response: new Response(null, { status: 503, headers: { 'Retry-After': '1' } }),
  error: { code: 'request.busy' },
})
const ok = () => ({ response: new Response(null, { status: 201 }) })

// 14yq6g334bn part 2 (PR E review): the busy retry's wait can be called off, so a screen that goes away does not send
// a write the person can no longer see.
describe('onceMoreIfBusy and sleep take an AbortSignal (14yq6g334bn)', () => {
  afterEach(() => vi.useRealTimers())

  it('sleep waits the time it is given', async () => {
    vi.useFakeTimers()
    let done = false
    void sleep(1_000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('sleep ends at once on abort, before or during the wait, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    const before = new AbortController()
    before.abort()
    await sleep(1_000, before.signal)
    const during = new AbortController()
    let done = false
    void sleep(1_000, during.signal).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(10)
    during.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a busy answer is sent once more after the wait', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok())
    const result = onceMoreIfBusy(send, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await result).response.status).toBe(201)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('an abort during the wait sends nothing more and answers with the busy result', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok())
    const controller = new AbortController()
    const result = onceMoreIfBusy(send, controller.signal)
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    expect((await result).response.status).toBe(503)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
