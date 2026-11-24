import type { ReactNode } from 'react'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'

type ConfirmDialogProps = {
  title: string
  children: ReactNode
  confirmLabel: string
  pending: boolean
  error?: unknown
  onConfirm: () => void
  onCancel: () => void
}

/** A destructive action always asks first; Cancel comes first so it takes the initial focus. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="mb-4 text-sm">{children}</p>
      {error != null && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {messageOf(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
