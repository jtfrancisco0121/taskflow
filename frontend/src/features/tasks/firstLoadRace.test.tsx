import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { expectRestarted, put } from '../../test/firstLoadRace'
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
      { holdRefetch: true, check: () => expect(sends).toBe(2) },
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

  it('useOptimisticTaskMutation restarts a subtask scan on its first load', async () => {
    await expectRestarted(
      queryKeys.subtaskScan('l1'),
      () => ({}),
      () => useOptimisticTaskMutation(),
      (run, wrote) => run(job(wrote)),
    )
  })
})
