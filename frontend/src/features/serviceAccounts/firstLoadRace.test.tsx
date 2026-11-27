import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useRestoreTask } from './hooks'

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

describe('serviceAccounts: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useRestoreTask (restore from the trash)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'POST /api/v1/tasks/:id/restore': put(wrote, task(1)) }),
      () => useRestoreTask(w),
      (restore) => restore.mutateAsync({ taskId: 't1', version: 2 }),
    )
  })
})
