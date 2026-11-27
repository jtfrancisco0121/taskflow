import { QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { installFetch, json, newQueryClient } from '../../test/api'
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

  it('useRestoreTask refreshes accounts, tasks and views in one round (a view does not wait on the accounts)', async () => {
    installFetch({ 'POST /api/v1/tasks/:id/restore': json(task(1)) })
    const queryClient = newQueryClient()
    let accountReads = 0
    const accounts = new QueryObserver(queryClient, {
      queryKey: queryKeys.serviceAccounts(w),
      queryFn: async () => {
        accountReads += 1
        if (accountReads > 1) await new Promise(() => {}) // the account refetch never answers
        return 'loaded'
      },
    })
    const stopAccounts = accounts.subscribe(() => {})
    await waitFor(() => expect(accounts.getCurrentResult().data).toBe('loaded'))
    let viewReads = 0
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const view = new QueryObserver(queryClient, {
      queryKey: viewKey,
      queryFn: async () => {
        viewReads += 1
        if (viewReads === 1) await held
        return viewReads
      },
    })
    const stopView = view.subscribe(() => {})
    await waitFor(() => expect(viewReads).toBe(1))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRestoreTask(w), { wrapper })
    act(() => {
      void result.current.mutateAsync({ taskId: 't1', version: 2 }).catch(() => undefined)
    })
    await waitFor(() => expect(accountReads).toBe(2))
    await waitFor(() => expect(viewReads).toBe(2))
    release()
    await waitFor(() => expect(view.getCurrentResult().data).toBe(2))
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    expect(viewReads).toBe(2)
    expect(accountReads).toBe(2)
    stopAccounts()
    stopView()
  })
})
