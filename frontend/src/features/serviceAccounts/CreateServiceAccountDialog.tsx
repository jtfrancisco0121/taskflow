import { useState, type FormEvent } from 'react'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { TextField } from '../../shared/ui/TextField'
import { isStatus, useCreateServiceAccount } from './hooks'

type Props = {
  workspaceId: string
  onClose: () => void
  onCreated: (id: string) => void
}

export function CreateServiceAccountDialog({ workspaceId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const create = useCreateServiceAccount(workspaceId)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(name.trim(), {
      onSuccess: (account) => {
        onClose()
        if (account.id) onCreated(account.id)
      },
    })
  }

  const taken = isStatus(create.error, 409)
  return (
    <Dialog title="Create service account" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label="Name"
          value={name}
          maxLength={100}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          error={
            taken
              ? 'A service account with this name already exists'
              : create.error
                ? messageOf(create.error)
                : undefined
          }
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create service account'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
