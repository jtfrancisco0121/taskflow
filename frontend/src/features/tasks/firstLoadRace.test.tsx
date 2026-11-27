import { describe, it } from 'vitest'
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
})
