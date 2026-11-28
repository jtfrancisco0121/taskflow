import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { PageHeader } from '../../shared/ui/PageHeader'
import { AuditTab } from './AuditTab'
import { isStatus, useServiceAccount, useSetEnabled } from './hooks'
import { KeysTab } from './KeysTab'
import { ManageDenied } from './ManageDenied'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'

type Tab = 'keys' | 'audit'

/** FR-5, FR-6, FR-9: one service account, with its keys and its audit view. */
export function ServiceAccountDetailPage() {
  const { workspaceId = '', serviceAccountId = '' } = useParams()
  const account = useServiceAccount(workspaceId, serviceAccountId)
  const setEnabled = useSetEnabled(workspaceId, serviceAccountId)
  const [tab, setTab] = useState<Tab>('keys')

  if (isStatus(account.error, 403)) return <ManageDenied />
  if (account.isPending) {
    return <p role="status">Loading…</p>
  }
  // Not pending and no data (the first load failed), or a 404 on a refresh: the error. Other refresh failures keep the
  // page with a notice, below.
  if (!hasData(account) || loadFailed(account)) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[960px] rounded border border-red-300 bg-red-50 p-3 text-sm"
      >
        <p className="mb-2 text-red-900">{messageOf(account.error)}</p>
        <Button onClick={() => void account.refetch()}>Retry</Button>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'keys', label: 'Keys' },
    { id: 'audit', label: 'Audit' },
  ]
  return (
    <div className="mx-auto max-w-[960px]">
      <p className="mb-2 text-sm">
        <Link
          to={`/w/${workspaceId}/settings/service-accounts`}
          className="text-blue-700 hover:underline"
        >
          Service accounts
        </Link>
      </p>
      <PageHeader title={account.data.name ?? 'Service account'}>
        {account.data.disabled && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            Disabled
          </span>
        )}
      </PageHeader>
      {refreshFailed(account) && (
        <div className="mb-4">
          <RefreshNotice
            message={messageOf(account.error)}
            onRetry={() => void account.refetch()}
          />
        </div>
      )}
      {account.data.disabled && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <span>Disabled: its keys do not work</span>
          <Button disabled={setEnabled.isPending} onClick={() => setEnabled.mutate(true)}>
            Enable
          </Button>
        </div>
      )}
      <div
        role="tablist"
        aria-label="Service account"
        className="mb-4 flex gap-2 border-b border-slate-200"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'keys' ? (
          <KeysTab workspaceId={workspaceId} accountId={serviceAccountId} />
        ) : (
          <AuditTab workspaceId={workspaceId} accountId={serviceAccountId} />
        )}
      </div>
    </div>
  )
}
