import { QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { json, newQueryClient } from '../../test/api'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useChecklistWrites } from './useChecklists'
import { useOptimisticTaskMutation } from './useOptimisticTaskMutation'
import { useUpdateTask } from './useUpdateTask'

const w = 'w1'
const viewKey = queryKeys.view(w, 'l1', 'h')
const tasksKey = queryKeys.tasks(w, 'l1')
const task = (n: number) => ({
  id: `t${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  title: `Task ${n}`,
  version: 1,
})
const taskView = task(1) as unknown as TaskView

describe('tasks: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useOptimisticTaskMutation (status, priority, assignee, Board move)', async () => {
    await expectRestarted(
      viewKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) =>
        run({
          task: { id: 't1', workspaceId: w, version: 1 },
          optimistic: { priority: 'HIGH' },
          send: async () => {
            wrote()
            return { response: new Response(null, { status: 200 }), data: taskView }
          },
        }),
    )
  })

  it('useUpdateTask (task panel edit)', async () => {
    await expectRestarted(
      tasksKey,
      (wrote) => ({ 'PATCH /api/v1/tasks/:id': put(wrote, task(1)) }),
      () => useUpdateTask('t1'),
      (update) => update.mutateAsync({ title: 'New' }),
    )
  })

  it('useUpdateTask: saved and the next queued edit do not wait for the refetch', async () => {
    let patches = 0
    await expectRestarted(
      tasksKey,
      (wrote) => ({
        'PATCH /api/v1/tasks/:id': () => {
          patches += 1
          return put(wrote, task(1))(new Request('http://x'), null)
        },
      }),
      () => useUpdateTask('t1'),
      async (update) => {
        const first = update.mutateAsync({ title: 'One' })
        const second = update.mutateAsync({ title: 'Two' })
        await first
        await second
      },
      {
        holdRefetch: true,
        expectedReads: 3,
        check: ({ write }) => {
          expect(patches).toBeGreaterThanOrEqual(2)
          expect(write.isPending).toBe(false)
        },
      },
    )
  })

  it('useOptimisticTaskMutation (409 conflict path)', async () => {
    await expectRestarted(
      viewKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) =>
        run({
          task: { id: 't1', workspaceId: w, version: 1 },
          optimistic: { priority: 'HIGH' },
          send: async () => {
            wrote()
            return {
              response: new Response(null, { status: 409 }),
              error: { current: { ...taskView, version: 2 } },
            }
          },
        }),
    )
  })

  const job = (wrote: () => void, sent?: () => void) => ({
    task: { id: 't1', workspaceId: w, version: 1 },
    optimistic: { priority: 'HIGH' as const },
    send: async () => {
      wrote()
      sent?.()
      return { response: new Response(null, { status: 200 }), data: taskView }
    },
  })

  it('useOptimisticTaskMutation: saved and the next queued write do not wait for the refetch', async () => {
    let sends = 0
    await expectRestarted(
      viewKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      async (run, wrote) => {
        const first = run(job(wrote, () => (sends += 1)))
        const second = run(job(wrote, () => (sends += 1)))
        expect(await first).toBe('saved')
        expect(await second).toBe('saved')
      },
      {
        holdRefetch: true,
        expectedReads: 2, // the second write's snapshot runs before the first restart's refetch starts, so one refetch covers both
        check: () => expect(sends).toBe(2),
      },
    )
  })

  it('useOptimisticTaskMutation restarts the task detail on its first load', async () => {
    await expectRestarted(
      queryKeys.task('t1'),
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(job(wrote)),
    )
  })

  const activityKey = queryKeys.activity('t1')

  it('useUpdateTask restarts the activity on its first load', async () => {
    await expectRestarted(
      activityKey,
      (wrote) => ({ 'PATCH /api/v1/tasks/:id': put(wrote, task(1)) }),
      () => useUpdateTask('t1'),
      (update) => update.mutateAsync({ title: 'New' }),
    )
  })

  it('useUpdateTask 409 restarts the activity on its first load', async () => {
    await expectRestarted(
      activityKey,
      (wrote) => ({
        'PATCH /api/v1/tasks/:id': () => {
          wrote()
          return json({ current: { ...task(1), version: 2 } }, 409)
        },
      }),
      () => useUpdateTask('t1'),
      (update) => update.mutateAsync({ title: 'New' }),
    )
  })

  it('useOptimisticTaskMutation restarts the activity on its first load', async () => {
    await expectRestarted(
      activityKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(job(wrote)),
    )
  })

  it('useOptimisticTaskMutation 409 restarts the activity on its first load', async () => {
    await expectRestarted(
      activityKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) =>
        run({
          ...job(wrote),
          send: async () => {
            wrote()
            return {
              response: new Response(null, { status: 409 }),
              error: { current: { ...taskView, version: 2 } },
            }
          },
        }),
    )
  })

  // The write may have landed although the client never saw the answer: restore, then read the server's truth.
  const unknownOutcome = (wrote: () => void, answer: () => Response) => ({
    ...job(wrote),
    send: async () => {
      wrote()
      return { response: answer() }
    },
  })

  it('useOptimisticTaskMutation refreshes a view on its first load after a lost response', async () => {
    await expectRestarted(
      viewKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) =>
        run({
          ...job(wrote),
          send: async () => {
            wrote()
            throw new TypeError('network')
          },
        }),
    )
  })

  it('useOptimisticTaskMutation refreshes a view on its first load after a 5xx', async () => {
    await expectRestarted(
      viewKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(unknownOutcome(wrote, () => new Response(null, { status: 502 }))),
    )
  })

  it('useOptimisticTaskMutation refreshes the activity on its first load after a 5xx', async () => {
    await expectRestarted(
      activityKey,
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(unknownOutcome(wrote, () => new Response(null, { status: 500 }))),
    )
  })

  it('useOptimisticTaskMutation: a lost response puts the server truth back into a loaded view', async () => {
    let server = 'before'
    const queryClient = newQueryClient()
    const observer = new QueryObserver(queryClient, {
      queryKey: viewKey,
      queryFn: async () => server,
    })
    const stop = observer.subscribe(() => {})
    await waitFor(() => expect(observer.getCurrentResult().data).toBe('before'))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    const outcome = await act(() =>
      result.current({
        ...job(() => (server = 'after')),
        send: async () => {
          server = 'after'
          throw new TypeError('network')
        },
      }),
    )
    expect(outcome).toBe('failed')
    await waitFor(() => expect(observer.getCurrentResult().data).toBe('after'))
    stop()
  })

  it('useOptimisticTaskMutation: a 4xx refusal (nothing written) refetches nothing', async () => {
    let reads = 0
    const queryClient = newQueryClient()
    const observer = new QueryObserver(queryClient, {
      queryKey: viewKey,
      queryFn: async () => (reads += 1),
    })
    const stop = observer.subscribe(() => {})
    await waitFor(() => expect(reads).toBe(1))
    const { result } = renderHook(() => useOptimisticTaskMutation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    const outcome = await act(() =>
      result.current(
        unknownOutcome(
          () => {},
          () => json({ title: 'x' }, 400),
        ),
      ),
    )
    expect(outcome).toBe('failed')
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    expect(reads).toBe(1)
    stop()
  })

  it('useChecklistWrites.add restarts the checklists on their first load', async () => {
    await expectRestarted(
      queryKeys.checklists('t1'),
      (wrote) => ({
        'POST /api/v1/tasks/:id/checklists': put(wrote, { id: 'c1', name: 'QA', items: [] }),
      }),
      () => useChecklistWrites('t1'),
      (writes) => writes.add('QA'),
    )
  })

  it('useOptimisticTaskMutation restarts a subtask scan on its first load', async () => {
    await expectRestarted(
      queryKeys.subtaskScan('l1'),
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(job(wrote)),
    )
  })
})
