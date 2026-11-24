import { useToastStore } from '../toast-store'

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded border px-3 py-2 text-sm shadow ${
            toast.kind === 'error'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
            className="rounded px-1 hover:bg-black/5"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
