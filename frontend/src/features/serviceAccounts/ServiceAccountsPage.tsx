import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import type { ServiceAccountView } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { PageHeader } from '../../shared/ui/PageHeader'
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
            <div key={row} className="h-8 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
      )}
      {refreshFailed(query) && (
        <RefreshNotice message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      )}
      {loadFailed(query) && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="mb-2 text-red-900">{messageOf(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      )}
      {hasData(query) && query.accounts.length === 0 && (
        <p className="text-sm text-slate-600">
          No service accounts yet. Create one to give an agent its own access.
        </p>
      )}
      {hasData(query) && query.accounts.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Service accounts</caption>
          <thead className="text-xs font-medium text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Status</th>
              <th className="py-2">Keys</th>
              <th className="py-2">Last used</th>
              <th className="py-2">Created</th>
              <th className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {query.accounts.map((account) => (
              <tr key={account.id} className="border-t border-slate-200">
                <td className="py-2">
                  <Link
                    to={`/w/${workspaceId}/settings/service-accounts/${account.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {account.name}
                  </Link>
                </td>
                <td className="py-2">
                  {account.disabled ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      Disabled
                    </span>
                  ) : (
                    'Enabled'
                  )}
                </td>
                <td className="py-2">{account.activeKeys ?? 0}</td>
                <td className="py-2">
                  {account.lastUsedAt ? relativeTime(account.lastUsedAt) : 'Never'}
                </td>
                <td className="py-2">{formatDay(account.createdAt)}</td>
                <td className="py-2 text-right">
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
