import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { messageOf } from '../../api/errors'
import type { CreatedApiKey } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { Select } from '../../shared/ui/Select'
import { TextField } from '../../shared/ui/TextField'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate } from '../../api/refresh'
import { useToastStore } from '../../shared/toast-store'
import { isStatus, revokeApiKey, useCreateApiKey } from './hooks'

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
  const queryClient = useQueryClient()
  const show = useToastStore((state) => state.show)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A key is only safe if its secret reaches the one-time dialog, so the dialog cannot be closed mid-create.
  const close = () => {
    if (!create.isPending) onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || create.isPending) return
    const days = expiry === 'never' ? null : Number(expiry)
    const expiresAt =
      days === null ? undefined : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
    create.mutateAsync({ name: name.trim(), expiresAt }).then(
      (created) => {
        if (mounted.current) {
          onClose()
          onCreated(created)
          // The secret now lives only in the one-time dialog's state.
          create.reset()
          return
        }
        // Unmounted mid-create (the page changed): the secret can never be shown, so the key must not stay
        // active. Revoke it and say so; the secret is not kept, logged or put in the message.
        const keyId = created.key?.id
        const label = created.key?.name ?? 'The new key'
        if (!keyId) return
        revokeApiKey(workspaceId, accountId, keyId).then(
          () => {
            show(
              `Key ${label} was created while its window was closing, so it was revoked. Create a new key.`,
            )
            void cancelThenInvalidate(queryClient, {
              queryKey: queryKeys.serviceAccountsAll(workspaceId),
            })
          },
          () =>
            show(
              `Key ${label} was created while its window was closing and could not be revoked. Revoke it in the Keys tab.`,
              'error',
            ),
        )
      },
      // A failed create shows its error through create.error while mounted; unmounted, nothing exists to clean up.
      () => undefined,
    )
  }

  const pastExpiry = isStatus(create.error, 422)
  return (
    <Dialog title="Create key" onClose={close}>
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
            <p role="alert" className="text-sm text-danger">
              {messageOf(create.error)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button disabled={create.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
