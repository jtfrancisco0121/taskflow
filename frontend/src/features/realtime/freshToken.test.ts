import { describe, expect, it } from 'vitest'
import { isExpiring } from './LiveUpdates'

const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp }))}.s`

describe('isExpiring', () => {
  it('flags an expired token', () => expect(isExpiring(jwt(1000), 2_000_000)).toBe(true))
  it('keeps a valid token', () => expect(isExpiring(jwt(4000), 2_000_000)).toBe(false))
  it('treats an unreadable token as usable', () => expect(isExpiring('opaque')).toBe(false))
})
