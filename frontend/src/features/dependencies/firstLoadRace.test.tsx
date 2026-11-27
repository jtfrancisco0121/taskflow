import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useAddDependency } from './useDependencies'

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
})
