import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import {
  useCreateApiKey,
  useCreateServiceAccount,
  useRestoreTask,
  useRevokeApiKey,
  useSetEnabled,
} from './hooks'

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

  const accounts = queryKeys.serviceAccounts(w)
  it('useCreateServiceAccount restarts the account list on its first load', async () => {
    await expectRestarted(
      accounts,
      (wrote) => ({
        'POST /api/v1/workspaces/:workspaceId/service-accounts': put(wrote, { id: 'a1' }),
      }),
      () => useCreateServiceAccount(w),
      (create) => create.mutateAsync('bot'),
    )
  })

  it('useSetEnabled restarts the account on its first load', async () => {
    await expectRestarted(
      queryKeys.serviceAccount(w, 'a1'),
      (wrote) => ({
        'POST /api/v1/workspaces/:workspaceId/service-accounts/:id/disable': put(wrote, {}),
      }),
      () => useSetEnabled(w, 'a1'),
      (set) => set.mutateAsync(false),
    )
  })

  it('useCreateApiKey restarts the key list on its first load', async () => {
    await expectRestarted(
      queryKeys.apiKeys(w, 'a1'),
      (wrote) => ({
        'POST /api/v1/workspaces/:workspaceId/service-accounts/:id/api-keys': put(wrote, {}),
      }),
      () => useCreateApiKey(w, 'a1'),
      (create) => create.mutateAsync({ name: 'k' }),
    )
  })

  it('useRevokeApiKey restarts the key list on its first load', async () => {
    await expectRestarted(
      queryKeys.apiKeys(w, 'a1'),
      (wrote) => ({
        'DELETE /api/v1/workspaces/:workspaceId/service-accounts/:id/api-keys/:keyId': put(
          wrote,
          {},
        ),
      }),
      () => useRevokeApiKey(w, 'a1'),
      (revoke) => revoke.mutateAsync('k1'),
    )
  })

  it('useRestoreTask restarts the account audit on its first load', async () => {
    await expectRestarted(
      queryKeys.saAudit(w, 'a1'),
      (wrote) => ({ 'POST /api/v1/tasks/:id/restore': put(wrote, task(1)) }),
      () => useRestoreTask(w),
      (restore) => restore.mutateAsync({ taskId: 't1', version: 2 }),
    )
  })
})
