import { useState } from 'react'
import { useToastStore, type Toast } from '../toast-store'

function ActionButton({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss)
  const [busy, setBusy] = useState(false)
  const action = toast.action
  if (!action) return null
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await action.onAction()
        } finally {
          dismiss(toast.id)
        }
      }}
      className="rounded px-1 font-medium text-accent hover:bg-surface-2 disabled:opacity-50"
    >
      {action.label}
    </button>
  )
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-(--tf-z-toast) flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={`glass flex items-start gap-3 rounded-lg px-3 py-2 text-[13px] text-fg ${
            toast.kind === 'error' ? 'border-danger bg-danger-soft' : ''
          }`}
        >
          <span>{toast.message}</span>
          <ActionButton toast={toast} />
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
            className="rounded px-1 text-muted hover:bg-surface-2"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
