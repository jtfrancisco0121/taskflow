import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useAddDependency, useRemoveDependency } from './useDependencies'

const w = 'w1'
const viewKey = queryKeys.view(w, 'l1', 'h')
const task = (n: number) => ({
  id: `t${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  title: `Task ${n}`,
  version: 1,
})
const taskView = task(1) as unknown as TaskView

describe('dependencies: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useAddDependency (both tasks change version)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({
        'POST /api/v1/tasks/:id/dependencies': put(wrote, { task: task(1) }),
      }),
      () => useAddDependency(taskView),
      (add) => add.mutateAsync({ otherTaskId: 't2', relation: 'BLOCKS' } as never),
    )
  })

  it('useRemoveDependency (both tasks change version)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({
        'DELETE /api/v1/tasks/:id/dependencies/:dependencyId': put(wrote, {}),
        'GET /api/v1/tasks/:id': { ...task(1) },
      }),
      () => useRemoveDependency(taskView),
      (remove) => remove.mutateAsync({ dependencyId: 'd1', otherTaskId: 't2' }),
    )
  })

  const add = (wrote: () => void) => ({
    'POST /api/v1/tasks/:id/dependencies': put(wrote, { task: task(1) }),
  })

  it('useAddDependency restarts the Dependencies panel on its first load', async () => {
    await expectRestarted(
      queryKeys.dependencies('t1'),
      add,
      () => useAddDependency(taskView),
      (a) => a.mutateAsync({ otherTaskId: 't2', relation: 'BLOCKS' } as never),
    )
  })

  it('useAddDependency restarts the other task on its first load', async () => {
    await expectRestarted(
      queryKeys.task('t2'),
      add,
      () => useAddDependency(taskView),
      (a) => a.mutateAsync({ otherTaskId: 't2', relation: 'BLOCKS' } as never),
    )
  })

  it('useAddDependency settles without waiting for the refetch of the lists', async () => {
    await expectRestarted(
      viewKey,
      add,
      () => useAddDependency(taskView),
      (a) => a.mutateAsync({ otherTaskId: 't2', relation: 'BLOCKS' } as never),
      { holdRefetch: true, check: ({ write }) => expect(write.isPending).toBe(false) },
    )
  })
})
