import { useState, type FormEvent } from 'react'
import { messageOf } from '../../api/errors'
import type { CreatedApiKey } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { Select } from '../../shared/ui/Select'
import { TextField } from '../../shared/ui/TextField'
import { isStatus, useCreateApiKey } from './hooks'

const EXPIRY = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '365 days' },
  { value: 'never', label: 'No expiry' },
] as const

type Props = {
  workspaceId: string
  accountId: string
  onClose: () => void
  /** Hands the one response that carries the secret to the one-time dialog. */
  onCreated: (created: CreatedApiKey) => void
}

export function CreateKeyDialog({ workspaceId, accountId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['value']>('90')
  const create = useCreateApiKey(workspaceId, accountId)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const days = expiry === 'never' ? null : Number(expiry)
    const expiresAt =
      days === null ? undefined : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
    create.mutate(
      { name: name.trim(), expiresAt },
      {
        onSuccess: (created) => {
          onClose()
          onCreated(created)
          // The secret now lives only in the one-time dialog's state.
          create.reset()
        },
      },
    )
  }

  const pastExpiry = isStatus(create.error, 422)
  return (
    <Dialog title="Create key" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label="Name"
          value={name}
          maxLength={100}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          error={create.error && !pastExpiry ? messageOf(create.error) : undefined}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="key-expiry" className="text-sm font-medium">
            Expires
          </label>
          <Select
            id="key-expiry"
            value={expiry}
            onValueChange={(next) => setExpiry(next as typeof expiry)}
            options={EXPIRY}
          />
          {pastExpiry && (
            <p role="alert" className="text-sm text-red-700">
              {messageOf(create.error)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
