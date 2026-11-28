// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ApiError } from './errors'
import { hasData, loadFailed, refreshFailed } from './queryState'

// ClickUp 14yq6g334fe: a failed background refresh keeps the last data on screen; only a failed first load blanks it.
describe('query load states', () => {
  const firstLoadError = { status: 'error', data: undefined } as const
  const refreshError = { status: 'error', data: { id: 't1' } } as const
  const loaded = { status: 'success', data: { id: 't1' } } as const
  const loading = { status: 'pending', data: undefined } as const

  it('loadFailed is true only for an error with no data', () => {
    expect(loadFailed(firstLoadError)).toBe(true)
    expect(loadFailed(refreshError)).toBe(false)
    expect(loadFailed(loaded)).toBe(false)
    expect(loadFailed(loading)).toBe(false)
  })

  it('refreshFailed is true only for an error with data still held', () => {
    expect(refreshFailed(refreshError)).toBe(true)
    expect(refreshFailed(firstLoadError)).toBe(false)
    expect(refreshFailed(loaded)).toBe(false)
    expect(refreshFailed(loading)).toBe(false)
  })

  it('hasData holds through a failed refresh, and counts a null result as data', () => {
    expect(hasData(refreshError)).toBe(true)
    expect(hasData(loaded)).toBe(true)
    expect(hasData({ status: 'success', data: null })).toBe(true)
    expect(hasData(firstLoadError)).toBe(false)
    expect(hasData(loading)).toBe(false)
  })

  it('a 401, 403 or 404 on a refresh is the error screen, not a stale-data notice; a 500 keeps the data', () => {
    const failedWith = (status: number) => ({
      status: 'error' as const,
      data: { id: 't1' },
      error: new ApiError({ status }),
    })
    for (const status of [401, 403, 404]) {
      expect(loadFailed(failedWith(status))).toBe(true)
      expect(refreshFailed(failedWith(status))).toBe(false)
    }
    for (const status of [401, 403, 404]) expect(hasData(failedWith(status))).toBe(false)
    expect(hasData(failedWith(500))).toBe(true)
    expect(loadFailed(failedWith(500))).toBe(false)
    expect(refreshFailed(failedWith(500))).toBe(true)
  })
})
