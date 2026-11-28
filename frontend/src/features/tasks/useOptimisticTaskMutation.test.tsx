import { QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewQueryResponse } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { newQueryClient } from '../../test/api'
import { flushViewRefreshNow } from './taskCaches'
import {
  CONFLICT_MESSAGE,
  taskMutationGate,
  useOptimisticTaskMutation,
} from './useOptimisticTaskMutation'

const task = (extra: Partial<TaskView> = {}): TaskView => ({
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  title: 'One',
  priority: 'NORMAL',
  version: 3,
  ...extra,
})

function setup() {
  const queryClient = newQueryClient()
  const key = queryKeys.view('w1', 'l1', 'h', undefined)
  const data: InfiniteData<ViewQueryResponse> = {
    pages: [{ items: [{ group: 'a', task: task() }] }],
    pageParams: [undefined],
  }
  queryClient.setQueryData(key, data)
  queryClient.setQueryData(queryKeys.task('t1'), task())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useOptimisticTaskMutation(), { wrapper })
  const shown = () =>
    queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(key)?.pages[0].items?.[0].task
  return { queryClient, run: result.current, shown }
}

describe('useOptimisticTaskMutation (AD-20)', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('shows the change at once, sends the cached version and keeps the response', async () => {
    const { run, shown, queryClient } = setup()
    let sentVersion: number | undefined
    let during: string | null | undefined
    const outcome = await act(() =>
      run({
        task: task(),
        optimistic: { priority: 'URGENT' },
        send: async (version) => {
          sentVersion = version
          during = shown()?.priority
          return {
            response: new Response(null, { status: 200 }),
            data: task({ priority: 'URGENT', version: 4 }),
          }
        },
      }),
    )
    expect(outcome).toBe('saved')
    expect(sentVersion).toBe(3)
    expect(during).toBe('URGENT')
    expect(shown()?.version).toBe(4)
    expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(4)
  })

  it('rolls back on a 5xx and on a network error and tells the user', async () => {
    const { run, shown } = setup()
    const failed = await act(() =>
      run({
        task: task(),
        optimistic: { priority: 'URGENT' },
        send: async () => ({
          response: new Response(null, { status: 500 }),
          error: { status: 500, detail: 'Boom' },
        }),
      }),
    )
    expect(failed).toBe('failed')
    expect(shown()?.priority).toBe('NORMAL')
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Boom')

    const offline = await act(() =>
      run({
        task: task(),
        optimistic: { priority: 'LOW' },
        send: async () => {
          throw new TypeError('network')
        },
      }),
    )
    expect(offline).toBe('failed')
    expect(shown()?.priority).toBe('NORMAL')
  })

  it("on 409 writes the server's current task and shows the conflict notice", async () => {
    const { run, shown, queryClient } = setup()
    const current = task({ title: 'Changed elsewhere', version: 7 })
    const outcome = await act(() =>
      run({
        task: task(),
        optimistic: { title: 'Mine' },
        send: async () => ({ response: new Response(null, { status: 409 }), error: { current } }),
      }),
    )
    expect(outcome).toBe('conflict')
    expect(shown()?.title).toBe('Changed elsewhere')
    expect(queryClient.getQueryData<TaskView>(queryKeys.task('t1'))?.version).toBe(7)
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(CONFLICT_MESSAGE)
  })

  it('holds Live events for a pending task until it settles', async () => {
    const { run } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const events: string[] = []
    const mutation = run({
      task: task(),
      send: async () => {
        await gate
        return { response: new Response(null, { status: 200 }), data: task({ version: 4 }) }
      },
    })
    expect(taskMutationGate.isPending('t1')).toBe(true)
    taskMutationGate.whenSettled('t1', () => events.push('applied'))
    expect(events).toEqual([])
    release()
    await act(() => mutation)
    expect(events).toEqual(['applied'])
    expect(taskMutationGate.isPending('t1')).toBe(false)
  })

  it('runs two writes to one task in order, each with the then-current version', async () => {
    const { run } = setup()
    const versions: Array<number | undefined> = []
    const send = (next: number) => async (version: number | undefined) => {
      versions.push(version)
      return { response: new Response(null, { status: 200 }), data: task({ version: next }) }
    }
    await act(() =>
      Promise.all([run({ task: task(), send: send(4) }), run({ task: task(), send: send(5) })]),
    )
    expect(versions).toEqual([3, 4])
  })

  // 14yq6g334tg guard: a saved write that changes the task's group reads every view again (a Board column holding
  // the task in place would keep it under its old group); a write that keeps the group does not (no extra reads).
  const invalidated = (queryClient: ReturnType<typeof setup>['queryClient']) =>
    queryClient.getQueryState(queryKeys.view('w1', 'l1', 'h', undefined))?.isInvalidated
  it.each([
    ['status', { statusId: 'st-doing' }],
    ['priority', { priority: 'URGENT' }],
    ['assignees', { assigneeIds: ['u2'] }],
    ['List', { listId: 'l2' }],
    ['due date', { dueDate: '2026-12-20T17:00:00Z' }],
    ['custom field', { customFields: { f1: ['o-a', 'o-b'] } }],
  ] as const)('a saved %s change reads the loaded views again', async (_name, change) => {
    const { run, queryClient } = setup()
    await act(() =>
      run({
        task: task(),
        optimistic: change as Partial<TaskView>,
        send: async () => ({
          response: new Response(null, { status: 200 }),
          data: task({ ...(change as Partial<TaskView>), version: 4 }),
        }),
      }),
    )
    await vi.waitFor(() => expect(invalidated(queryClient)).toBe(true))
  })

  it('a saved change that keeps the group (a title, the same assignees reordered, the same fields) reads no view again', async () => {
    const { run, queryClient } = setup()
    const cached = task({ assigneeIds: ['u1', 'u2'], customFields: { f1: 'o-a', f2: 3, f3: null } })
    queryClient.setQueryData(queryKeys.task('t1'), cached)
    // The view holds the same copy (14yq6g334bn m3: a save is judged against each view's own copy too).
    queryClient.setQueryData<InfiniteData<ViewQueryResponse>>(
      queryKeys.view('w1', 'l1', 'h', undefined),
      { pages: [{ items: [{ group: 'a', task: cached }] }], pageParams: [undefined] },
    )
    await act(() =>
      run({
        task: task(),
        optimistic: { title: 'Renamed' },
        send: async () => ({
          response: new Response(null, { status: 200 }),
          data: task({
            title: 'Renamed',
            assigneeIds: ['u2', 'u1'],
            customFields: { f2: 3, f1: 'o-a' },
            version: 4,
          }),
        }),
      }),
    )
    // m4: run the gathered refresh now, so a scheduled read would have run (no waiting on real timers).
    act(() => flushViewRefreshNow(queryClient))
    expect(invalidated(queryClient)).toBe(false)
  })
  // 14yq6g334tg r2 M2: a refusal (4xx) undoes only this write's own change.
  const refused = () => ({
    response: new Response(JSON.stringify({ code: 'access.denied' }), { status: 403 }),
    error: { code: 'access.denied' },
  })

  it('a 4xx with nothing changed meanwhile puts the view back and reads no view again', async () => {
    const { run, queryClient, shown } = setup()
    const outcome = await act(() =>
      run({
        task: task(),
        optimistic: { title: 'Mine' },
        silent: true,
        send: async () => refused(),
      }),
    )
    expect(outcome).toBe('failed')
    expect(shown()?.title).toBe('One')
    act(() => flushViewRefreshNow(queryClient))
    expect(invalidated(queryClient)).toBe(false)
  })

  it('a 4xx keeps a view another save changed meanwhile and reads it again', async () => {
    const { run, queryClient } = setup()
    const key = queryKeys.view('w1', 'l1', 'h', undefined)
    const other = { id: 't2', workspaceId: 'w1', listId: 'l1', title: 'Other saved', version: 2 }
    const outcome = await act(() =>
      run({
        task: task(),
        optimistic: { title: 'Mine' },
        silent: true,
        send: async () => {
          // Another save's refresh lands while this one waits: the view now lists the other task too.
          queryClient.setQueryData<InfiniteData<ViewQueryResponse>>(key, (d) => ({
            ...d!,
            pages: [{ items: [...(d!.pages[0].items ?? []), { group: 'a', task: other }] }],
          }))
          return refused()
        },
      }),
    )
    expect(outcome).toBe('failed')
    const items = queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(key)?.pages[0].items
    expect(items?.some((i) => i.task?.id === 't2')).toBe(true)
    // It may still hold this write's optimistic title: it is read again.
    await vi.waitFor(() => expect(invalidated(queryClient)).toBe(true))
  })
})
