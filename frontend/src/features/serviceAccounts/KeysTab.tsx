import { useEffect, useRef, useState } from 'react'
import { messageOf } from '../../api/errors'
import type { ApiKeyView, CreatedApiKey } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { ConfirmDialog } from './ConfirmDialog'
import { CreateKeyDialog } from './CreateKeyDialog'
import { useApiKeys, useRevokeApiKey } from './hooks'
import { OneTimeKeyDialog } from './OneTimeKeyDialog'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

const STATUS: Record<string, string> = { ACTIVE: 'Active', REVOKED: 'Revoked', EXPIRED: 'Expired' }
const PILL: Record<string, string> = {
  ACTIVE: 'bg-ok-soft',
  REVOKED: 'bg-surface-3',
  EXPIRED: 'bg-warn-soft',
}

/** The URL a client connects to; the key goes in the Authorization header. */
export function mcpUrl(): string {
  return `${window.location.origin}/api/v1/mcp`
}

/**
 * How to connect an MCP client: the URL (with Copy), the transport and the header. It never holds a key: the header
 * shows a placeholder, and the key itself appears only once, in the one-time dialog.
 */
function McpSetup() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const url = mcpUrl()

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // The URL is selectable, so a failed clipboard write is not a dead end.
    }
  }

  return (
    <section
      aria-labelledby="mcp-setup"
      className="rounded-md border border-line bg-surface p-4 text-[13px] text-fg"
    >
      <h2 id="mcp-setup" className="mb-3 font-display text-base font-semibold">
        MCP setup
      </h2>
      <dl className="m-0 grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
        <dt className="text-xs font-medium text-muted">MCP URL</dt>
        <dd className="m-0 flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-2 px-2 py-1 font-mono select-all">
            {url}
          </code>
          <Button aria-label="Copy MCP URL" onClick={() => void copy()}>
            Copy
          </Button>
        </dd>
        <dt className="text-xs font-medium text-muted">Transport</dt>
        <dd className="m-0">Streamable HTTP</dd>
        <dt className="text-xs font-medium text-muted">Header</dt>
        <dd className="m-0">
          <code className="rounded-sm bg-surface-2 px-2 py-1 font-mono">
            Authorization: Bearer &lt;key&gt;
          </code>
        </dd>
      </dl>
      <p className="mt-3 text-muted">Send the key in the Authorization header.</p>
      <p aria-live="polite" className="mt-1 h-5 text-muted">
        {copied ? 'URL copied' : ''}
      </p>
    </section>
  )
}

function RevokeButton({
  workspaceId,
  accountId,
  apiKey,
}: {
  workspaceId: string
  accountId: string
  apiKey: ApiKeyView
}) {
  const [confirming, setConfirming] = useState(false)
  const revoke = useRevokeApiKey(workspaceId, accountId)
  return (
    <>
      <Button
        variant="danger"
        aria-label={`Revoke key ${apiKey.name}`}
        onClick={() => setConfirming(true)}
      >
        Revoke
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Revoke key"
          confirmLabel="Revoke"
          pending={revoke.isPending}
          error={revoke.error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => revoke.mutate(apiKey.id!, { onSuccess: () => setConfirming(false) })}
        >
          Revoke key {apiKey.name}? Agents using it stop working immediately. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  )
}

/** KEY-1..KEY-4: the keys of one service account, with the one-time reveal on create. */
export function KeysTab({ workspaceId, accountId }: { workspaceId: string; accountId: string }) {
  const keys = useApiKeys(workspaceId, accountId)
  const [creating, setCreating] = useState(false)
  // The secret lives only in this state; closing the dialog drops it.
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <McpSetup />
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create key
        </Button>
      </div>
      {keys.isPending && (
        <div role="status" aria-label="Loading keys" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      )}
      {refreshFailed(keys) && (
        <RefreshNotice message={messageOf(keys.error)} onRetry={() => void keys.refetch()} />
      )}
      {loadFailed(keys) && (
        <ErrorState message={messageOf(keys.error)} onRetry={() => void keys.refetch()} />
      )}
      {hasData(keys) && keys.data.length === 0 && (
        <EmptyState title="No keys yet" description="Create one to connect an agent." />
      )}
      {hasData(keys) && keys.data.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-line bg-surface text-left text-[13px] text-fg">
          <caption className="sr-only">API keys</caption>
          <thead className="bg-surface-2 text-xs font-medium text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.data.map((apiKey) => (
              <tr key={apiKey.id} className="border-t border-line">
                <td className="px-3 py-2 font-medium">{apiKey.name}</td>
                <td className="px-3 py-2 font-mono">
                  {apiKey.prefix}…{apiKey.last4}
                </td>
                <td className="px-3 py-2">
                  {apiKey.expiresAt ? formatDay(apiKey.expiresAt) : 'Never'}
                </td>
                <td className="px-3 py-2">
                  {apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : 'Never'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs text-fg ${PILL[apiKey.status ?? ''] ?? 'bg-surface-3'}`}
                  >
                    {STATUS[apiKey.status ?? ''] ?? apiKey.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {apiKey.status === 'ACTIVE' && (
                    <RevokeButton workspaceId={workspaceId} accountId={accountId} apiKey={apiKey} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <CreateKeyDialog
          workspaceId={workspaceId}
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={setRevealed}
        />
      )}
      {revealed?.secret && (
        <OneTimeKeyDialog
          keyName={revealed.key?.name ?? ''}
          secret={revealed.secret}
          onDone={() => setRevealed(null)}
        />
      )}
    </div>
  )
}
