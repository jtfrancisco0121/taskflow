import { create } from 'zustand'

export type ToastAction = { label: string; onAction: () => void | Promise<void> }
export type Toast = {
  id: number
  message: string
  kind: 'info' | 'error'
  action?: ToastAction
  durationMs?: number
}
type ToastOptions = { action?: ToastAction; durationMs?: number }

type ToastState = {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind'], options?: ToastOptions) => number
  /** Changes a toast that is still shown and restarts its timer. */
  update: (id: number, patch: Partial<Pick<Toast, 'message' | 'action' | 'durationMs'>>) => void
  dismiss: (id: number) => void
}

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const useToastStore = create<ToastState>((set, get) => {
  // Errors stay until dismissed; other toasts hide after 6 s (or their own duration).
  function arm(id: number, kind: Toast['kind'], durationMs?: number) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    if (kind === 'error') return
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
      }, durationMs ?? 6000),
    )
  }
  return {
    toasts: [],
    show: (message, kind = 'info', options = {}) => {
      const id = nextId++
      set((state) => ({ toasts: [...state.toasts, { id, message, kind, ...options }] }))
      arm(id, kind, options.durationMs)
      return id
    },
    update: (id, patch) => {
      const current = get().toasts.find((t) => t.id === id)
      if (!current) return
      const next = { ...current, ...patch }
      set((state) => ({ toasts: state.toasts.map((t) => (t.id === id ? next : t)) }))
      arm(id, next.kind, next.durationMs)
    },
    dismiss: (id) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },
  }
})
