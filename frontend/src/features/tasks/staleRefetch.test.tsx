import {
  InfiniteQueryObserver,
  QueryClientProvider,
  QueryObserver,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewConfig, ViewQueryResponse } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useToastStore } from '../../shared/toast-store'
import { flushViewRefreshNow, regroups, writeTaskToCaches } from './taskCaches'
import { useOptimisticTaskMutation } from './useOptimisticTaskMutation'
import { useUpdateTask } from './useUpdateTask'

// 14yq6g334bn: a read that left before a write and lands after it must not overwrite the write, in any cached query
// that shows the task (its detail, the task lists, the views), and a lost response must not flicker or make the next
// queued write conflict with itself.

const task = (extra: Partial<TaskView> = {}): TaskView => ({
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  title: 'One',
  statusId: 'st-todo',
  priority: 'NORMAL',
  assigneeIds: [],
  version: 3,
  ...extra,
})
type Pages = InfiniteData<ViewQueryResponse>
const pages = (...tasks: TaskView[]): Pages => ({
  pages: [{ items: tasks.map((t) => ({ group: 'a', task: t })) }],
  pageParams: [undefined],
})
const viewKey = queryKeys.view('w1', 'l1', 'h', undefined)
const taskListKey = [...queryKeys.tasksAll('w1'), 'l1'] as const

/** A server read the test answers by hand: each call waits until `answer(i, value)` or `fail(i)`. */
function heldReads<T>() {
  const calls: Array<{ resolve: (v: T) => void; reject: (e: unknown) => void; aborted: boolean }> =
    []
  const queryFn = ({ signal }: { signal: AbortSignal }) =>
    new Promise<T>((resolve, reject) => {
      const call = { resolve, reject, aborted: false }
      signal.addEventListener('abort', () => (call.aborted = true))
      calls.push(call)
    })
  return {
    calls,
    queryFn,
    answer: (i: number, v: T) => calls[i].resolve(v),
    fail: (i: number) => calls[i].reject(new Error('boom')),
  }
}

/** Keeps a query active (as a mounted screen would) with a held queryFn and the given data already loaded. */
function watch<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  data: T,
  meta?: Record<string, unknown>,
) {
  const reads = heldReads<T>()
  queryClient.setQueryData(queryKey, data)
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: reads.queryFn as never,
    staleTime: Infinity,
    retry: false,
    meta,
  })
  const stop = observer.subscribe(() => {})
  const startRefetch = () => void queryClient.refetchQueries({ queryKey, exact: true })
  return { ...reads, stop, startRefetch }
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const shownIn = (queryClient: QueryClient) =>
  queryClient.getQueryData<Pages>(viewKey)?.pages[0].items?.[0].task
const detail = (queryClient: QueryClient) =>
  queryClient.getQueryData<TaskView>(queryKeys.task('t1'))

describe('14yq6g334bn stale background reads after a save', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('AC1 useUpdateTask: a loaded detail and task list read in flight at the save do not overwrite it', async () => {
    const saved = task({ title: 'Saved', version: 4 })
    installFetch({ 'PATCH /api/v1/tasks/:id': json(saved) } as never)
    const queryClient = newQueryClient()
    const one = watch(queryClient, queryKeys.task('t1'), task())
    const list = watch(queryClient, taskListKey, {
      pages: [{ items: [task()] }],
      pageParams: [undefined],
    })
    // Background reads (a focus refetch, a Live refresh) leave before the save commits.
    one.startRefetch()
    list.startRefetch()
    await waitFor(() => expect(one.calls).toHaveLength(1))
    const { result } = renderHook(() => useUpdateTask('t1'), { wrapper: wrapperFor(queryClient) })
    await act(() => result.current.mutateAsync({ title: 'Saved' }))
    expect(detail(queryClient)?.title).toBe('Saved')

    // The stale answers land after the save: they were aborted, so nothing changes.
    act(() => {
      one.answer(0, task())
      list.answer(0, { pages: [{ items: [task()] }], pageParams: [undefined] })
    })
    expect(one.calls[0].aborted).toBe(true)
    expect(list.calls[0].aborted).toBe(true)
    expect(detail(queryClient)?.title).toBe('Saved')
    // Read again after the commit.
    await waitFor(() => expect(one.calls).toHaveLength(2))
    act(() => one.answer(1, saved))
    await waitFor(() => expect(detail(queryClient)?.version).toBe(4))
    one.stop()
    list.stop()
  })

  it('AC1 negative: with no read in flight the save sends no extra read', async () => {
    installFetch({
      'PATCH /api/v1/tasks/:id': json(task({ title: 'Saved', version: 4 })),
    } as never)
    const queryClient = newQueryClient()
    const one = watch(queryClient, queryKeys.task('t1'), task())
    const { result } = renderHook(() => useUpdateTask('t1'), { wrapper: wrapperFor(queryClient) })
    await act(() => result.current.mutateAsync({ title: 'Saved' }))
    act(() => flushViewRefreshNow(queryClient))
    expect(one.calls).toHaveLength(0)
    expect(detail(queryClient)?.title).toBe('Saved')
    one.stop()
  })

  it('AC2 optimistic: a loaded view read in flight when the save starts keeps the optimistic change, and is read again', async () => {
    const queryClient = newQueryClient()
    const view = watch(queryClient, viewKey, pages(task()))
    view.startRefetch()
    await waitFor(() => expect(view.calls).toHaveLength(1))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    let answer!: () => void
    const gate = new Promise<void>((resolve) => (answer = resolve))
    const saving = result.current({
      task: task(),
      optimistic: { title: 'Mine' },
      send: async () => {
        await gate
        return {
          response: new Response(null, { status: 200 }),
          data: task({ title: 'Mine', version: 4 }),
        }
      },
    })
    await waitFor(() => expect(shownIn(queryClient)?.title).toBe('Mine'))
    // The old read lands while the save is still waiting: it was aborted at the start, so the change stays.
    act(() => view.answer(0, pages(task())))
    expect(view.calls[0].aborted).toBe(true)
    expect(shownIn(queryClient)?.title).toBe('Mine')
    answer()
    await act(() => saving)
    // The aborted read is read again after the answer.
    await waitFor(() => expect(view.calls).toHaveLength(2))
    act(() => view.answer(1, pages(task({ title: 'Mine', version: 4 }))))
    await waitFor(() => expect(shownIn(queryClient)?.version).toBe(4))
    view.stop()
  })

  it('AC3 lost response: no flicker back to the old value, and the queued write sends the server version (no 409)', async () => {
    const queryClient = newQueryClient()
    const view = watch(queryClient, viewKey, pages(task()))
    const one = watch(queryClient, queryKeys.task('t1'), task())
    const seen: Array<string | undefined> = []
    const unsubscribe = queryClient
      .getQueryCache()
      .subscribe(() => seen.push(shownIn(queryClient)?.priority))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    const versions: Array<number | undefined> = []
    const first = result.current({
      task: task(),
      optimistic: { priority: 'URGENT' },
      silent: true,
      send: async () => {
        throw new TypeError('network') // the write landed (v4) but its answer was lost
      },
    })
    const second = result.current({
      task: task(),
      optimistic: { title: 'Next' },
      silent: true,
      send: async (version) => {
        versions.push(version)
        return {
          response: new Response(null, { status: 200 }),
          data: task({ priority: 'URGENT', title: 'Next', version: 5 }),
        }
      },
    })
    await waitFor(() => expect(one.calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(view.calls.length).toBeGreaterThan(0))
    const landed = task({ priority: 'URGENT', version: 4 })
    act(() => {
      one.answer(one.calls.length - 1, landed)
      view.answer(view.calls.length - 1, pages(landed))
    })
    expect(await act(() => first)).toBe('failed')
    expect(await act(() => second)).toBe('saved')
    expect(versions).toEqual([4])
    const firstUrgent = seen.indexOf('URGENT')
    expect(firstUrgent).toBeGreaterThanOrEqual(0)
    expect(seen.slice(firstUrgent)).not.toContain('NORMAL')
    unsubscribe()
    view.stop()
    one.stop()
  })

  it('AC3 negative: a lost response whose refresh fails puts the old value back', async () => {
    const queryClient = newQueryClient()
    const view = watch(queryClient, viewKey, pages(task()))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    const run = result.current({
      task: task(),
      optimistic: { priority: 'URGENT' },
      silent: true,
      send: async () => {
        throw new TypeError('network')
      },
    })
    await waitFor(() => expect(view.calls.length).toBeGreaterThan(0))
    expect(shownIn(queryClient)?.priority).toBe('URGENT')
    act(() => view.fail(view.calls.length - 1))
    expect(await act(() => run)).toBe('failed')
    await waitFor(() => expect(shownIn(queryClient)?.priority).toBe('NORMAL'))
    view.stop()
  })

  it.each([
    ['409', 'conflict'],
    ['network error', 'failed'],
  ] as const)(
    'AC4 (m1): in a Bulk change, a %s on task B does not put back task A saved meanwhile',
    async (kind, expected) => {
      const queryClient = newQueryClient()
      const a = task({ id: 'tA', title: 'A' })
      const b = task({ id: 'tB', title: 'B' })
      queryClient.setQueryData(viewKey, pages(a, b))
      const { result } = renderHook(() => useOptimisticTaskMutation(), {
        wrapper: wrapperFor(queryClient),
      })
      let answerB!: () => void
      const gateB = new Promise<void>((resolve) => (answerB = resolve))
      const runB = result.current({
        task: b,
        optimistic: { priority: 'URGENT' },
        silent: true,
        send: async () => {
          await gateB
          if (kind === '409')
            return {
              response: new Response(null, { status: 409 }),
              error: { current: task({ id: 'tB', title: 'B', version: 9 }) },
            }
          throw new TypeError('network')
        },
      })
      const runA = result.current({
        task: a,
        optimistic: { priority: 'HIGH' },
        silent: true,
        send: async () => ({
          response: new Response(null, { status: 200 }),
          data: task({ id: 'tA', title: 'A', priority: 'HIGH', version: 4 }),
        }),
      })
      expect(await act(() => runA)).toBe('saved')
      answerB()
      expect(await act(() => runB)).toBe(expected)
      const items = queryClient.getQueryData<Pages>(viewKey)?.pages[0].items ?? []
      const shownA = items.find((i) => i.task?.id === 'tA')?.task
      expect(shownA?.priority).toBe('HIGH')
      expect(shownA?.version).toBe(4)
      // B's own change is undone in place (after its refresh, for a lost response).
      await waitFor(() => {
        const now = queryClient.getQueryData<Pages>(viewKey)?.pages[0].items ?? []
        expect(now.find((i) => i.task?.id === 'tB')?.task?.priority).toBe('NORMAL')
        expect(now.find((i) => i.task?.id === 'tA')?.task?.priority).toBe('HIGH')
      })
    },
  )

  it('AC6 (m3): a save is judged against the view copy, not only a stale task cache', async () => {
    const queryClient = newQueryClient()
    // The task cache still says "to do"; the view, read later, shows "in progress".
    queryClient.setQueryData(queryKeys.task('t1'), task({ statusId: 'st-todo' }))
    queryClient.setQueryData(viewKey, pages(task({ statusId: 'st-doing' })))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    await act(() =>
      result.current({
        task: task(),
        optimistic: { statusId: 'st-todo' },
        silent: true,
        send: async () => ({
          response: new Response(null, { status: 200 }),
          data: task({ statusId: 'st-todo', version: 4 }),
        }),
      }),
    )
    act(() => flushViewRefreshNow(queryClient))
    expect(queryClient.getQueryState(viewKey)?.isInvalidated).toBe(true)
  })
})

describe('14yq6g334bn views re-read by their own config (filters and sorts)', () => {
  const filtered: ViewConfig = { v: 1, filter: { field: 'tag', op: 'any_of', value: ['x'] } }
  const sortedByTitle: ViewConfig = { v: 1, sort: [{ key: 'title', dir: 'asc' }] }
  const plain: ViewConfig = { v: 1 }
  const keyOf = (name: string) => queryKeys.view('w1', 'l1', name, undefined)

  function setup() {
    const queryClient = newQueryClient()
    queryClient.setQueryData(queryKeys.task('t1'), task({ tags: ['x'] }))
    const views = {
      filtered: watch(queryClient, keyOf('f'), pages(task({ tags: ['x'] })), {
        viewConfig: filtered,
      }),
      sorted: watch(queryClient, keyOf('s'), pages(task({ tags: ['x'] })), {
        viewConfig: sortedByTitle,
      }),
      plain: watch(queryClient, keyOf('p'), pages(task({ tags: ['x'] })), { viewConfig: plain }),
    }
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    const save = (change: Partial<TaskView>) =>
      act(() =>
        result.current({
          task: task(),
          optimistic: change,
          silent: true,
          send: async () => ({
            response: new Response(null, { status: 200 }),
            data: task({ tags: ['x'], ...change, version: 4 }),
          }),
        }),
      )
    const invalidated = (name: string) => queryClient.getQueryState(keyOf(name))?.isInvalidated
    const stop = () => Object.values(views).forEach((v) => v.stop())
    return { queryClient, save, invalidated, stop }
  }

  it('AC5: a change to a field a view filters on re-reads that view only', async () => {
    const { queryClient, save, invalidated, stop } = setup()
    await save({ tags: [] })
    act(() => flushViewRefreshNow(queryClient))
    expect(invalidated('f')).toBe(true)
    expect(invalidated('s')).toBe(false)
    expect(invalidated('p')).toBe(false)
    stop()
  })

  it('AC5: a change to a field a view sorts on re-reads that view only', async () => {
    const { queryClient, save, invalidated, stop } = setup()
    await save({ title: 'Zed' })
    act(() => flushViewRefreshNow(queryClient))
    expect(invalidated('s')).toBe(true)
    expect(invalidated('f')).toBe(false)
    expect(invalidated('p')).toBe(false)
    stop()
  })

  it('AC5 negative: a change to a field no view uses re-reads no view', async () => {
    const { queryClient, save, invalidated, stop } = setup()
    await save({ description: { type: 'doc' } as never })
    act(() => flushViewRefreshNow(queryClient))
    expect(invalidated('f')).toBe(false)
    expect(invalidated('s')).toBe(false)
    expect(invalidated('p')).toBe(false)
    stop()
  })
})

describe('14yq6g334bn PR #35 review items 3 and 4', () => {
  it('AC9 (#35-3): a title save with no cached task detail reads no view again', async () => {
    installFetch({
      'PATCH /api/v1/tasks/:id': json(task({ title: 'Renamed', version: 4 })),
    } as never)
    const queryClient = newQueryClient()
    queryClient.setQueryData(viewKey, pages(task()))
    const { result } = renderHook(() => useUpdateTask('t1'), { wrapper: wrapperFor(queryClient) })
    await act(() => result.current.mutateAsync({ title: 'Renamed' }))
    act(() => flushViewRefreshNow(queryClient))
    expect(queryClient.getQueryState(viewKey)?.isInvalidated).toBe(false)
    expect(shownIn(queryClient)?.title).toBe('Renamed')
  })

  it('AC9 (#35-4): a custom field cleared to "" or [] is the same "No value" group as absent', () => {
    const before = task({ customFields: {} })
    expect(regroups(before, task({ customFields: { f1: '' } }))).toBe(false)
    expect(regroups(before, task({ customFields: { f1: [] } }))).toBe(false)
    expect(regroups(before, task({ customFields: { f1: null } }))).toBe(false)
    // Negative: a real value is still a group change.
    expect(regroups(before, task({ customFields: { f1: 'o-a' } }))).toBe(true)
    expect(regroups(before, task({ customFields: { f1: ['o-a'] } }))).toBe(true)
  })
})

describe('PR #45 review round 2', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('R2-1: after a lost response, a queued write sends the newest version although the cached detail is not shown', async () => {
    const queryClient = newQueryClient()
    const view = watch(queryClient, viewKey, pages(task()))
    // The task detail is cached (a panel was open earlier) but nothing observes it: a refresh does not refetch it.
    queryClient.setQueryData(queryKeys.task('t1'), task())
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    const versions: Array<number | undefined> = []
    const first = result.current({
      task: task(),
      optimistic: { priority: 'URGENT' },
      silent: true,
      send: async () => {
        throw new TypeError('network') // landed as v4, answer lost
      },
    })
    const second = result.current({
      task: task(),
      optimistic: { title: 'Next' },
      silent: true,
      send: async (version) => {
        versions.push(version)
        return {
          response: new Response(null, { status: 200 }),
          data: task({ priority: 'URGENT', title: 'Next', version: 5 }),
        }
      },
    })
    await waitFor(() => expect(view.calls.length).toBeGreaterThan(0))
    act(() => view.answer(view.calls.length - 1, pages(task({ priority: 'URGENT', version: 4 }))))
    expect(await act(() => first)).toBe('failed')
    expect(await act(() => second)).toBe('saved')
    expect(versions).toEqual([4])
    view.stop()
  })

  it('R2-2: a refused save with a Load more in flight reads the view again after it lands', async () => {
    const queryClient = newQueryClient()
    const reads = heldReads<ViewQueryResponse>()
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey: viewKey,
      queryFn: reads.queryFn as never,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: ViewQueryResponse) => last.nextCursor ?? undefined,
      staleTime: Infinity,
      retry: false,
    })
    const stop = observer.subscribe(() => {})
    await waitFor(() => expect(reads.calls).toHaveLength(1))
    act(() => reads.answer(0, { items: [{ group: 'a', task: task() }], nextCursor: 'c2' }))
    await waitFor(() => expect(shownIn(queryClient)?.title).toBe('One'))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    let answer!: () => void
    const gate = new Promise<void>((resolve) => (answer = resolve))
    const saving = result.current({
      task: task(),
      optimistic: { title: 'Mine' },
      silent: true,
      send: async () => {
        await gate
        return {
          response: new Response(null, { status: 403 }),
          error: { code: 'access.denied' },
        }
      },
    })
    await waitFor(() => expect(shownIn(queryClient)?.title).toBe('Mine'))
    // Load more starts after the optimistic change: it rebuilds from pages holding "Mine".
    void observer.fetchNextPage()
    await waitFor(() => expect(reads.calls).toHaveLength(2))
    answer()
    expect(await act(() => saving)).toBe('failed')
    expect(shownIn(queryClient)?.title).toBe('One')
    act(() => reads.answer(1, { items: [{ group: 'a', task: task({ id: 't9' }) }] }))
    // Read again after it lands (both pages), answered with the server's truth.
    await waitFor(() => expect(reads.calls).toHaveLength(3))
    act(() => reads.answer(2, { items: [{ group: 'a', task: task() }], nextCursor: 'c2' }))
    await waitFor(() => expect(reads.calls).toHaveLength(4))
    act(() => reads.answer(3, { items: [{ group: 'a', task: task({ id: 't9' }) }] }))
    await waitFor(() => expect(queryClient.getQueryState(viewKey)?.fetchStatus).toBe('idle'))
    expect(shownIn(queryClient)?.title).toBe('One')
    stop()
  })

  it('R2-m1: undoing a lost write keeps a newer copy another save wrote meanwhile', async () => {
    const queryClient = newQueryClient()
    const b = task({ id: 'tB', title: 'B' })
    queryClient.setQueryData(viewKey, pages(b))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: wrapperFor(queryClient),
    })
    const run = result.current({
      task: b,
      optimistic: { priority: 'URGENT' },
      silent: true,
      send: async () => {
        // A task panel save of B answers first and is written everywhere.
        writeTaskToCaches(
          queryClient,
          task({ id: 'tB', title: 'Panel', priority: 'URGENT', version: 5 }),
        )
        throw new TypeError('network')
      },
    })
    expect(await act(() => run)).toBe('failed')
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    const shown = shownIn(queryClient)
    expect(shown?.version).toBe(5)
    expect(shown?.title).toBe('Panel')
  })
})
