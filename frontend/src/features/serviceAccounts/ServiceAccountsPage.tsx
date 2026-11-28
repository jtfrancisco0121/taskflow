import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import type { ServiceAccountView } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { ConfirmDialog } from './ConfirmDialog'
import { CreateServiceAccountDialog } from './CreateServiceAccountDialog'
import { isStatus, useServiceAccounts, useSetEnabled } from './hooks'
import { ManageDenied } from './ManageDenied'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

function DisableButton({
  workspaceId,
  account,
}: {
  workspaceId: string
  account: ServiceAccountView
}) {
  const [confirming, setConfirming] = useState(false)
  const setEnabled = useSetEnabled(workspaceId, account.id!)
  if (account.disabled) {
    return (
      <Button
        aria-label={`Enable ${account.name}`}
        disabled={setEnabled.isPending}
        onClick={() => setEnabled.mutate(true)}
      >
        Enable
      </Button>
    )
  }
  return (
    <>
      <Button
        variant="danger"
        aria-label={`Disable ${account.name}`}
        onClick={() => setConfirming(true)}
      >
        Disable
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Disable service account"
          confirmLabel="Disable"
          pending={setEnabled.isPending}
          error={setEnabled.error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => setEnabled.mutate(false, { onSuccess: () => setConfirming(false) })}
        >
          Disable {account.name}? All its keys stop working until you enable it again.
        </ConfirmDialog>
      )}
    </>
  )
}

/** SA-1, SA-3: the Workspace's service accounts; create, open, disable, enable. */
export function ServiceAccountsPage() {
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const query = useServiceAccounts(workspaceId)
  const [creating, setCreating] = useState(false)

  if (isStatus(query.error, 403)) return <ManageDenied />

  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader title="Service accounts">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create service account
        </Button>
      </PageHeader>
      {query.isPending && (
        <div role="status" aria-label="Loading service accounts" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      )}
      {refreshFailed(query) && (
        <RefreshNotice message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      )}
      {loadFailed(query) && (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      )}
      {hasData(query) && query.accounts.length === 0 && (
        <EmptyState
          title="No service accounts yet"
          description="Create one to give an agent its own access."
        />
      )}
      {hasData(query) && query.accounts.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-line bg-surface text-left text-[13px] text-fg">
          <caption className="sr-only">Service accounts</caption>
          <thead className="bg-surface-2 text-xs font-medium text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Keys</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {query.accounts.map((account) => (
              <tr key={account.id} className="border-t border-line">
                <td className="px-3 py-2">
                  <Link
                    to={`/w/${workspaceId}/settings/service-accounts/${account.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {account.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {account.disabled ? (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-fg">
                      Disabled
                    </span>
                  ) : (
                    'Enabled'
                  )}
                </td>
                <td className="px-3 py-2">{account.activeKeys ?? 0}</td>
                <td className="px-3 py-2">
                  {account.lastUsedAt ? relativeTime(account.lastUsedAt) : 'Never'}
                </td>
                <td className="px-3 py-2">{formatDay(account.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  <DisableButton workspaceId={workspaceId} account={account} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <CreateServiceAccountDialog
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(id) => void navigate(`/w/${workspaceId}/settings/service-accounts/${id}`)}
        />
      )}
    </div>
  )
}
