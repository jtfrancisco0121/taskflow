import { useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { ErrorState } from '../../shared/ui/ErrorState'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { AuditTab } from './AuditTab'
import { isStatus, useServiceAccount, useSetEnabled } from './hooks'
import { KeysTab } from './KeysTab'
import { ManageDenied } from './ManageDenied'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'

type Tab = 'keys' | 'audit'

const TABS: { id: Tab; label: string }[] = [
  { id: 'keys', label: 'Keys' },
  { id: 'audit', label: 'Audit' },
]

/** FR-5, FR-6, FR-9: one service account, with its keys and its audit view. */
export function ServiceAccountDetailPage() {
  const { workspaceId = '', serviceAccountId = '' } = useParams()
  const account = useServiceAccount(workspaceId, serviceAccountId)
  const setEnabled = useSetEnabled(workspaceId, serviceAccountId)
  const [tab, setTab] = useState<Tab>('keys')
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  // WAI-ARIA tabs: one tab stop; the arrow keys, Home and End move and select.
  function onTabKey(event: KeyboardEvent) {
    const at = TABS.findIndex((t) => t.id === tab)
    const next =
      event.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1
    if (next < 0) return
    event.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  if (isStatus(account.error, 403)) return <ManageDenied />
  if (account.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading service account"
        className="mx-auto flex max-w-[960px] flex-col gap-3"
      >
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  // Not pending and no data (the first load failed), or a 404 on a refresh: the error. Other refresh failures keep the
  // page with a notice, below.
  if (!hasData(account) || loadFailed(account)) {
    return (
      <div className="mx-auto max-w-[960px]">
        <ErrorState message={messageOf(account.error)} onRetry={() => void account.refetch()} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[960px]">
      <p className="mb-2 text-sm">
        <Link
          to={`/w/${workspaceId}/settings/service-accounts`}
          className="text-accent hover:underline"
        >
          Service accounts
        </Link>
      </p>
      <PageHeader title={account.data.name ?? 'Service account'}>
        {account.data.disabled && (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-fg">Disabled</span>
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
          className="mb-4 flex items-center justify-between rounded-md border border-line-strong bg-warn-soft p-3 text-[13px] text-fg"
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
        className="mb-4 flex gap-2 border-b border-line"
        onKeyDown={onTabKey}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(node) => {
              tabRefs.current[t.id] = node
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-(--tf-dur-fast) ${tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
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
