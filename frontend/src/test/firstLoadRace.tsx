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
  options: {
    holdRefetch?: boolean
    /** With `holdRefetch`: the exact number of reads of the probe (the stale first read plus one per restart). */
    expectedReads?: number
    check?: (state: { write: T }) => void
    /**
     * The probe's first load starts after the write began (after an optimistic onMutate cancelled the key) and
     * before the server applied it: each write route waits until that load is in flight. The onMutate cancel cannot
     * reach this load, so whatever runs when the write settles (onSettled, onError) has to restart it.
     */
    startDuringWrite?: boolean
  } = {},
) {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => (release = resolve))
  let written = false
  let reads = 0
  const wrote = () => {
    written = true
  }
  let writeReached = false
  let letWriteIn: () => void = () => {}
  const probeLoading = new Promise<void>((resolve) => (letWriteIn = resolve))
  const table = routes(wrote)
  if (options.startDuringWrite)
    for (const [route, handler] of Object.entries(table)) {
      if (route.startsWith('GET ')) continue
      table[route] = async (request: Request, body: unknown) => {
        writeReached = true
        await probeLoading
        if (typeof handler === 'function') return (handler as StubHandler)(request, body)
        return handler instanceof Response ? handler.clone() : json(handler)
      }
    }
  installFetch(table as never)
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  const useProbe = () =>
    useQuery({
      queryKey: key,
      queryFn: async () => {
        reads += 1
        const seen = written
        if (reads === 1) await opened // the server read the list before the write
        if (reads > 1 && options.holdRefetch) await new Promise(() => {})
        return seen ? 'after' : 'before'
      },
    })
  const writer = renderHook(() => useWrite(), { wrapper }).result
  let probe = options.startDuringWrite ? undefined : renderHook(useProbe, { wrapper }).result
  if (!options.startDuringWrite) await waitFor(() => expect(reads).toBe(1))
  let firing: Promise<unknown> = Promise.resolve()
  act(() => {
    firing = fire(writer.current, wrote)
  })
  if (options.startDuringWrite) {
    await waitFor(() => expect(writeReached).toBe(true))
    probe = renderHook(useProbe, { wrapper }).result
    await waitFor(() => expect(reads).toBe(1))
    letWriteIn()
  }
  await waitFor(() => expect(written).toBe(true))
  release()
  await act(() => firing)
  if (options.holdRefetch) {
    const expectedReads = options.expectedReads ?? 2
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(expectedReads)) // one restart per saved write
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50))) // a late extra read must fail
    expect(reads).toBe(expectedReads)
    expect(probe!.current.data).toBeUndefined()
    options.check?.({ write: writer.current })
    return
  }
  await waitFor(() => expect(probe!.current.data).toBe('after'))
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
  expect(reads).toBe(2)
}

export const put =
  (wrote: () => void, body: object = {}): StubHandler =>
  () => {
    wrote()
    return json(body)
  }
