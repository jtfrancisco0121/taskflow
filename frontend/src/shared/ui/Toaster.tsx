import { useToastStore } from '../toast-store'

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
