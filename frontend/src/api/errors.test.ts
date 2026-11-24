import { describe, expect, it } from 'vitest'
import { ApiError, GENERIC_ERROR, messageOf, toApiError, unwrap } from './errors'

describe('errors', () => {
  it('NFR-3: shows the problem detail first', () => {
    const err = toApiError(new Response(null, { status: 400 }), {
      title: 'Bad Request',
      detail: 'Name is required',
      code: 'request.invalid',
    })
    expect(err.status).toBe(400)
    expect(err.code).toBe('request.invalid')
    expect(messageOf(err)).toBe('Name is required')
  })

  it('NFR-3: falls back to the title, then to the generic text', () => {
    expect(messageOf(toApiError(new Response(null, { status: 500 }), { title: 'Oops' }))).toBe(
      'Oops',
    )
    expect(messageOf(toApiError(new Response(null, { status: 500 }), null))).toBe(GENERIC_ERROR)
  })

  it('NFR-3: a network failure is status 0 with the connection message', async () => {
    const failing = Promise.reject(new TypeError('Failed to fetch'))
    const err = await unwrap(failing).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
    expect(messageOf(err)).toBe("Couldn't reach the server. Check your connection and try again.")
  })

  it('shows "Still saving" for idempotency conflicts', () => {
    const err = toApiError(new Response(null, { status: 409 }), {
      code: 'idempotency.in_progress',
      detail: 'x',
    })
    expect(messageOf(err)).toBe('Still saving, try again.')
  })

  it('unwrap returns data on success and throws ApiError otherwise', async () => {
    const ok = await unwrap(Promise.resolve({ data: { a: 1 }, response: new Response('{}') }))
    expect(ok).toEqual({ a: 1 })
    await expect(
      unwrap(
        Promise.resolve({ error: { title: 'No' }, response: new Response(null, { status: 403 }) }),
      ),
    ).rejects.toMatchObject({ status: 403, title: 'No' })
  })
})
