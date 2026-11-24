import { describe, expect, it } from 'vitest'
import { IdempotencyKeys } from './idempotency'

describe('IdempotencyKeys', () => {
  it('reuses the key for a retried body, changes it for a new body and after success', () => {
    const keys = new IdempotencyKeys()
    const first = keys.keyFor({ title: 'A' })
    expect(keys.keyFor({ title: 'A' })).toBe(first)
    expect(keys.keyFor({ title: 'B' })).not.toBe(first)
    const second = keys.keyFor({ title: 'B' })
    keys.done()
    expect(keys.keyFor({ title: 'B' })).not.toBe(second)
  })
})
