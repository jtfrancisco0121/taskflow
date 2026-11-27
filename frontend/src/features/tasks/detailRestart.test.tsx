import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useOptimisticTaskMutation } from './useOptimisticTaskMutation'
import { useUpdateTask } from './useUpdateTask'

const base = { id: 't1', workspaceId: 'w1', listId: 'l1', number: 1, title: 'Task 1' }
const stale = { ...base, version: 1 } as unknown as TaskView
const written = { ...base, title: 'Written', version: 2 } as unknown as TaskView

/** The task detail is on its first load (held) when a write lands; its refetch is held too. */
async function setup() {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => (release = resolve))
  let reads = 0
  const ifMatch: Array<string | null> = []
  installFetch({
    'PATCH /api/v1/tasks/:id': (request: Request) => {
      ifMatch.push(request.headers.get('If-Match'))
      return json(written)
    },
  } as never)
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  const { result } = renderHook(
    () => ({
      detail: useQuery({
        queryKey: queryKeys.task('t1'),
        queryFn: async () => {
          reads += 1
          if (reads === 1) await opened
          else await new Promise(() => {})
          return stale
        },
      }),
      update: useUpdateTask('t1'),
      optimistic: useOptimisticTaskMutation(),
    }),
    { wrapper },
  )
  await waitFor(() => expect(reads).toBe(1))
  return { result, release, ifMatch, queryClient, reads: () => reads }
}

/** Lets late answers and background restarts land before the assertions. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))

describe('task detail on its first load when a write lands', () => {
  it('useUpdateTask: the written task stays visible, with its version for If-Match', async () => {
    const { result, release, ifMatch, queryClient, reads } = await setup()
    await act(() => result.current.update.mutateAsync({ title: 'Written' }))
    await waitFor(() => expect(reads()).toBe(2)) // the restart cancelled the first read and refetches
    expect(result.current.detail.data).toEqual(written)
    release() // the stale first read answers late
    await settle()
    expect(result.current.detail.data).toEqual(written)
    expect(reads()).toBe(2)
    expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(2)
    await act(() => result.current.update.mutateAsync({ title: 'Again' }))
    expect(ifMatch[1]).toBe('"2"')
  })

  it('useOptimisticTaskMutation: the written task stays visible, with its version', async () => {
    const { result, release, queryClient, reads } = await setup()
    let sentWith: number | undefined = -1
    await act(() =>
      result.current.optimistic({
        task: { id: 't1', workspaceId: 'w1', version: 1 },
        send: async () => ({ response: new Response(null, { status: 200 }), data: written }),
      }),
    )
    await act(() =>
      result.current.optimistic({
        task: { id: 't1', workspaceId: 'w1', version: 1 },
        send: async (version) => {
          sentWith = version
          return { response: new Response(null, { status: 200 }), data: written }
        },
      }),
    )
    release()
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(2))
    await settle()
    expect(result.current.detail.data).toEqual(written)
    expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(2)
    expect(sentWith).toBe(2)
  })
})

describe('useOptimisticTaskMutation 409: the views are invalidated once', () => {
  const conflict = {
    task: { id: 't1', workspaceId: 'w1', version: 1 },
    optimistic: { priority: 'HIGH' as const },
    send: async () => ({
      response: new Response(null, { status: 409 }),
      error: { current: { ...written, version: 3 } },
    }),
  }

  /** How many invalidateQueries calls match the query at `key`. */
  async function invalidationsOf(key: readonly unknown[], data?: unknown) {
    installFetch({} as never)
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
    if (data !== undefined) queryClient.setQueryData(key, data)
    const { result } = renderHook(
      () => ({
        probe: useQuery({
          queryKey: key,
          queryFn: () =>
            data !== undefined ? Promise.resolve(data) : new Promise<never>(() => {}),
          staleTime: Infinity,
        }),
        run: useOptimisticTaskMutation(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(queryClient.getQueryState(key)).toBeDefined())
    const original = queryClient.invalidateQueries.bind(queryClient)
    let hits = 0
    queryClient.invalidateQueries = ((filters, options) => {
      const probe = queryClient.getQueryCache().find({ queryKey: key, exact: true })
      if (probe && queryClient.getQueryCache().findAll(filters).includes(probe)) hits += 1
      return original(filters, options)
    }) as typeof queryClient.invalidateQueries
    await act(() => result.current.run(conflict))
    return hits
  }

  const viewKey = queryKeys.view('w1', 'l1', 'h')

  it('a views query on its first load', async () => {
    expect(await invalidationsOf(viewKey)).toBe(1)
  })

  it('a loaded views query is still invalidated', async () => {
    expect(await invalidationsOf(viewKey, { pages: [], pageParams: [] })).toBe(1)
  })
})
