import { useState } from 'react'
import { messageOf } from '../../api/errors'
import type { ApiKeyView, CreatedApiKey } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { ConfirmDialog } from './ConfirmDialog'
import { CreateKeyDialog } from './CreateKeyDialog'
import { useApiKeys, useRevokeApiKey } from './hooks'
import { OneTimeKeyDialog } from './OneTimeKeyDialog'

const STATUS: Record<string, string> = { ACTIVE: 'Active', REVOKED: 'Revoked', EXPIRED: 'Expired' }

/** The URL a client connects to; the key goes in the Authorization header. */
export function mcpUrl(): string {
  return `${window.location.origin}/api/v1/mcp`
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
      <div className="rounded border border-slate-200 bg-white p-4">
        <p className="mb-1 text-xs font-medium text-slate-500">MCP URL</p>
        <code className="font-mono text-[13px] select-all">{mcpUrl()}</code>
        <p className="mt-1 text-sm text-slate-600">Send the key in the Authorization header.</p>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create key
        </Button>
      </div>
      {keys.isPending && (
        <div role="status" aria-label="Loading keys" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-8 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
      )}
      {keys.isError && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="mb-2 text-red-900">{messageOf(keys.error)}</p>
          <Button onClick={() => void keys.refetch()}>Retry</Button>
        </div>
      )}
      {keys.isSuccess && keys.data.length === 0 && (
        <p className="text-sm text-slate-600">No keys. Create one to connect an agent.</p>
      )}
      {keys.isSuccess && keys.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">API keys</caption>
          <thead className="text-xs font-medium text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Key</th>
              <th className="py-2">Expires</th>
              <th className="py-2">Last used</th>
              <th className="py-2">Status</th>
              <th className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.data.map((apiKey) => (
              <tr key={apiKey.id} className="border-t border-slate-200">
                <td className="py-2 font-medium">{apiKey.name}</td>
                <td className="py-2 font-mono text-[13px]">
                  {apiKey.prefix}…{apiKey.last4}
                </td>
                <td className="py-2">{apiKey.expiresAt ? formatDay(apiKey.expiresAt) : 'Never'}</td>
                <td className="py-2">
                  {apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : 'Never'}
                </td>
                <td className="py-2">{STATUS[apiKey.status ?? ''] ?? apiKey.status}</td>
                <td className="py-2 text-right">
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
