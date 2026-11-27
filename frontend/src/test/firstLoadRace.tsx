import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { expect } from 'vitest'
import { installFetch, json, newQueryClient, type StubHandler } from './api'

/**
 * A write that invalidates a list key while that list's first fetch is still in flight (no data yet): the late
 * response was read before the write, and invalidateQueries alone would not fetch again. The test holds the first
 * read of a probe query, lets the write land (the route calls `wrote()`), releases the stale read, and expects the
 * probe to end on the post-write data after a second read.
 */
export async function expectRestarted<T>(
  key: readonly unknown[],
  routes: (wrote: () => void) => Record<string, StubHandler | Response | object>,
  useWrite: () => T,
  fire: (write: T, wrote: () => void) => Promise<unknown>,
  /**
   * `holdRefetch`: the restart's refetch never answers. The write must still settle (the UI is not blocked on the
   * refetch), the restart must have started, and `check` sees the hook state while the refetch is pending.
   */
  options: { holdRefetch?: boolean; check?: (state: { write: T }) => void } = {},
) {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => (release = resolve))
  let written = false
  let reads = 0
  const wrote = () => {
    written = true
  }
  installFetch(routes(wrote) as never)
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  const { result } = renderHook(
    () => ({
      probe: useQuery({
        queryKey: key,
        queryFn: async () => {
          reads += 1
          const seen = written
          if (reads === 1) await opened // the server read the list before the write
          if (reads > 1 && options.holdRefetch) await new Promise(() => {})
          return seen ? 'after' : 'before'
        },
      }),
      write: useWrite(),
    }),
    { wrapper },
  )
  await waitFor(() => expect(reads).toBe(1))
  let firing: Promise<unknown> = Promise.resolve()
  act(() => {
    firing = fire(result.current.write, wrote)
  })
  await waitFor(() => expect(written).toBe(true))
  release()
  await act(() => firing)
  if (options.holdRefetch) {
    await waitFor(() => expect(reads).toBe(2))
    expect(result.current.probe.data).toBeUndefined()
    options.check?.(result.current)
    return
  }
  await waitFor(() => expect(result.current.probe.data).toBe('after'))
  expect(reads).toBe(2)
}

export const put =
  (wrote: () => void, body: object = {}): StubHandler =>
  () => {
    wrote()
    return json(body)
  }
