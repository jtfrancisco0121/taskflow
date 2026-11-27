import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useCreateWorkspace } from './useCreateWorkspace'

describe('workspace: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useCreateWorkspace restarts the workspaces list on its first load', async () => {
    await expectRestarted(
      queryKeys.workspaces(),
      (wrote) => ({ 'POST /api/v1/workspaces': put(wrote, { id: 'w9', name: 'New' }) }),
      () => useCreateWorkspace(),
      (create) => create.mutateAsync({ name: 'New' }),
    )
  })
})
