import { QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { ViewQueryResponse } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useOptimisticTaskMutation } from '../tasks'
import { createCachePatcher } from './cachePatcher'

const OWN = 'tab-own'
const task = (version: number, title = 'One') => ({
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  title,
  version,
})

function setup() {
  const queryClient = newQueryClient()
  const key = queryKeys.view('w1', 'l1', 'h')
  queryClient.setQueryData<InfiniteData<ViewQueryResponse>>(key, {
    pages: [{ items: [{ group: 'a', task: task(3) }] }],
    pageParams: [undefined],
  })
  queryClient.setQueryData(queryKeys.task('t1'), task(3))
  const stub = installFetch({ 'GET /api/v1/tasks/:id': () => json(task(5, 'Changed')) })
  const patcher = createCachePatcher(queryClient, { clientId: OWN, debounceMs: 500 })
  const title = () =>
    queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(key)?.pages[0].items?.[0].task?.title
  return { queryClient, stub, patcher, title }
}

const event = (extra = {}) => ({
  type: 'task.updated',
  entity: 'task',
  entityId: 't1',
  version: 5,
  listId: 'l1',
  clientId: 'someone-else',
  ...extra,
})

describe('RT-3 cache patcher', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('ignores an event with the tab’s own client id', async () => {
    const { patcher, stub, title } = setup()
    expect(await patcher.handle('w1', event({ clientId: OWN }))).toBe('own')
    expect(stub.calls).toHaveLength(0)
    expect(title()).toBe('One')
  })

  it('ignores an event at or below the cached version', async () => {
    const { patcher, stub } = setup()
    expect(await patcher.handle('w1', event({ version: 3 }))).toBe('stale')
    expect(await patcher.handle('w1', event({ version: 2 }))).toBe('stale')
    expect(stub.calls).toHaveLength(0)
  })

  it('refetches a newer task, patches every cached page and invalidates the views after 500 ms', async () => {
    const { patcher, stub, title, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(await patcher.handle('w1', event())).toBe('applied')
    expect(stub.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/tasks/t1'])
    expect(title()).toBe('Changed')
    expect(
      invalidate.mock.calls.some(
        ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(queryKeys.viewsAll('w1')),
      ),
    ).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(
      invalidate.mock.calls.some(
        ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(queryKeys.viewsAll('w1')),
      ),
    ).toBe(true)
    patcher.dispose()
  })

  it('holds an event while the user’s own mutation on the task is pending, then applies it', async () => {
    const { patcher, stub, title, queryClient } = setup()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useOptimisticTaskMutation(), { wrapper })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const mutation = result.current({
      task: task(3),
      send: async () => {
        await gate
        return { response: new Response(null, { status: 200 }), data: task(4, 'Mine') as never }
      },
    })
    expect(await patcher.handle('w1', event({ version: 5 }))).toBe('held')
    expect(stub.calls).toHaveLength(0)
    release()
    await act(() => mutation)
    await vi.waitFor(() =>
      expect(stub.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/tasks/t1']),
    )
    await vi.waitFor(() => expect(title()).toBe('Changed'))
    patcher.dispose()
  })

  it('a location event refreshes the tree and the view list', async () => {
    const { patcher, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(
      await patcher.handle('w1', { type: 'location.renamed', entity: 'location', entityId: 'f1' }),
    ).toBe('invalidated')
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys).toContain(JSON.stringify(queryKeys.treeAll('w1')))
    patcher.dispose()
  })

  it('FIELD: a value change refetches the task and a replayed event with an old version changes nothing', async () => {
    const { patcher, stub, title } = setup()
    // a value change rides on task.updated: a newer version is applied ...
    expect(await patcher.handle('w1', event({ version: 5 }))).toBe('applied')
    expect(title()).toBe('Changed')
    const calls = stub.calls.length
    // ... and the same event again (an outbox replay) is stale: no fetch, no change
    expect(await patcher.handle('w1', event({ version: 5 }))).toBe('stale')
    expect(await patcher.handle('w1', event({ version: 4 }))).toBe('stale')
    expect(stub.calls).toHaveLength(calls)
    patcher.dispose()
  })

  it('FIELD: a definition event refreshes the field lists, tasks and views and announces once', async () => {
    const queryClient = newQueryClient()
    const announce = vi.fn()
    const patcher = createCachePatcher(queryClient, { clientId: OWN, debounceMs: 500, announce })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const created = {
      type: 'custom_field.created',
      entity: 'location',
      entityId: 'l1',
      clientId: 'someone-else',
    }

    expect(await patcher.handle('w1', created)).toBe('invalidated')
    expect(await patcher.handle('w1', { ...created, type: 'custom_field.updated' })).toBe(
      'invalidated',
    )

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey ?? 'predicate'))
    expect(keys).toContain(JSON.stringify(queryKeys.taskAll()))
    expect(keys).toContain(JSON.stringify(queryKeys.tasksAll('w1')))
    // the field list predicate matches ['location', id, 'fields'] only
    const predicate = invalidate.mock.calls.map(([f]) => f?.predicate).find(Boolean)!
    expect(predicate({ queryKey: queryKeys.fields('l1') } as never)).toBe(true)
    expect(predicate({ queryKey: queryKeys.location('l1') } as never)).toBe(false)
    // a burst of definition events is announced once
    expect(announce.mock.calls.filter(([m]) => m === 'Fields changed.')).toHaveLength(1)
    patcher.dispose()
  })

  it('FIELD: a definition event with the tab’s own client id changes nothing', async () => {
    const queryClient = newQueryClient()
    const patcher = createCachePatcher(queryClient, { clientId: OWN })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(
      await patcher.handle('w1', {
        type: 'custom_field.created',
        entity: 'location',
        entityId: 'l1',
        clientId: OWN,
      }),
    ).toBe('own')
    expect(invalidate).not.toHaveBeenCalled()
  })

  describe('DEP relationship and blocker events (CAP-6, CAP-8)', () => {
    const blockedTask = (blocked: boolean) => ({
      ...task(3, 'One'),
      blocked,
      blockerCount: +blocked,
    })

    function dependencySetup(fresh: object) {
      const queryClient = newQueryClient()
      const key = queryKeys.view('w1', 'l1', 'h')
      queryClient.setQueryData<InfiniteData<ViewQueryResponse>>(key, {
        pages: [{ items: [{ group: 'a', task: blockedTask(true) }] }],
        pageParams: [undefined],
      })
      queryClient.setQueryData(queryKeys.task('t1'), blockedTask(true))
      queryClient.setQueryData(queryKeys.dependencies('t1'), { waitingOn: [{ dependencyId: 'd' }] })
      const stub = installFetch({ 'GET /api/v1/tasks/:id': () => json(fresh) })
      const patcher = createCachePatcher(queryClient, { clientId: OWN, debounceMs: 500 })
      const blockedInView = () =>
        queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(key)?.pages[0].items?.[0].task
          ?.blocked
      return { queryClient, stub, patcher, blockedInView, key }
    }

    const blockerEvent = (extra = {}) => ({
      type: 'task.blocker_resolved',
      entity: 'task',
      entityId: 't1',
      version: 3, // the dependent's version did not change
      listId: 'l1',
      clientId: 'someone-else',
      ...extra,
    })

    it('a blocker event refetches the task without a version comparison and refreshes the badge everywhere', async () => {
      const { patcher, stub, blockedInView, queryClient } = dependencySetup(blockedTask(false))
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      expect(await patcher.handle('w1', blockerEvent())).toBe('applied')
      expect(stub.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/tasks/t1'])
      expect(blockedInView()).toBe(false)
      expect(queryClient.getQueryData<{ blocked: boolean }>(queryKeys.task('t1'))?.blocked).toBe(
        false,
      )
      const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
      expect(keys).toContain(JSON.stringify(queryKeys.dependencies('t1')))
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(
        invalidate.mock.calls.some(
          ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(queryKeys.viewsAll('w1')),
        ),
      ).toBe(true)
      patcher.dispose()
    })

    it('a blocker event caused by this tab still refreshes the dependent (it only wrote the blocker)', async () => {
      const { patcher, blockedInView } = dependencySetup(blockedTask(false))
      expect(await patcher.handle('w1', blockerEvent({ clientId: OWN }))).toBe('applied')
      expect(blockedInView()).toBe(false)
      patcher.dispose()
    })

    it('delivering the same blocker event twice leaves the caches as after the first', async () => {
      const { patcher, queryClient, key } = dependencySetup(blockedTask(false))
      await patcher.handle('w1', blockerEvent())
      const after = JSON.stringify([
        queryClient.getQueryData(queryKeys.task('t1')),
        queryClient.getQueryData(key),
      ])
      expect(await patcher.handle('w1', blockerEvent())).toBe('applied')
      expect(
        JSON.stringify([
          queryClient.getQueryData(queryKeys.task('t1')),
          queryClient.getQueryData(key),
        ]),
      ).toBe(after)
      patcher.dispose()
    })

    it('a reopened blocker flips the badge back on', async () => {
      const { patcher, blockedInView } = dependencySetup(blockedTask(true))
      expect(await patcher.handle('w1', blockerEvent({ type: 'task.blocker_reopened' }))).toBe(
        'applied',
      )
      expect(blockedInView()).toBe(true)
      patcher.dispose()
    })

    it('a blocker event for a task nobody has open only refreshes the views', async () => {
      const queryClient = newQueryClient()
      const stub = installFetch({})
      const patcher = createCachePatcher(queryClient, { clientId: OWN })
      expect(await patcher.handle('w1', blockerEvent())).toBe('invalidated')
      expect(stub.calls).toHaveLength(0)
      patcher.dispose()
    })

    it('a relationship event invalidates the relationship list and follows the version rules', async () => {
      const { patcher, stub, queryClient } = dependencySetup({ ...blockedTask(true), version: 4 })
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      const added = event({ type: 'task.dependency_added', version: 4 })
      expect(await patcher.handle('w1', added)).toBe('applied')
      const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
      expect(keys).toContain(JSON.stringify(queryKeys.dependencies('t1')))
      // the same event again is stale: no second fetch, caches unchanged
      const calls = stub.calls.length
      expect(await patcher.handle('w1', added)).toBe('stale')
      expect(stub.calls).toHaveLength(calls)
      // removal from the other end, own client id: nothing
      expect(
        await patcher.handle('w1', event({ type: 'task.dependency_removed', clientId: OWN })),
      ).toBe('own')
      patcher.dispose()
    })
  })

  describe('subtask scans (AD-5)', () => {
    const scanKey = (listId: string) => queryKeys.subtaskScan(listId)
    function withScans() {
      const ctx = setup()
      ctx.queryClient.setQueryData(scanKey('l1'), { tasks: [], capped: false })
      ctx.queryClient.setQueryData(scanKey('l2'), { tasks: [], capped: false })
      const stale = (listId: string) =>
        ctx.queryClient.getQueryState(scanKey(listId))?.isInvalidated
      return { ...ctx, stale }
    }
    const unseen = (extra = {}) => event({ entityId: 'new1', version: 1, ...extra })

    it('a burst of events for tasks this tab never saw invalidates only that List’s scan, once', async () => {
      const { patcher, queryClient, stale } = withScans()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      for (const id of ['n1', 'n2', 'n3']) {
        expect(await patcher.handle('w1', unseen({ entityId: id }))).toBe('invalidated')
      }
      expect(stale('l1')).toBe(false)
      await vi.advanceTimersByTimeAsync(600)
      expect(stale('l1')).toBe(true)
      expect(stale('l2')).toBe(false)
      expect(
        invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === '["subtasks","l1"]'),
      ).toHaveLength(1)
    })

    it('an event for another List invalidates that List only', async () => {
      const { patcher, stale } = withScans()
      await patcher.handle('w1', unseen({ listId: 'l2' }))
      await vi.advanceTimersByTimeAsync(600)
      expect(stale('l2')).toBe(true)
      expect(stale('l1')).toBe(false)
    })

    it('a comment event, an event without a List, an applied event and a custom-field event leave the scans alone', async () => {
      const { patcher, stale } = withScans()
      await patcher.handle('w1', unseen({ type: 'comment.created' }))
      await patcher.handle('w1', unseen({ listId: null }))
      await patcher.handle('w1', event({ version: 9 })) // t1 is cached: applied
      await patcher.handle('w1', {
        type: 'custom_field.created',
        entity: 'location',
        entityId: 'l1',
        clientId: 'someone-else',
      })
      await vi.advanceTimersByTimeAsync(600)
      expect(stale('l1')).toBe(false)
      expect(stale('l2')).toBe(false)
    })
  })
})
