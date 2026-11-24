import { create } from 'zustand'

export type Toast = { id: number; message: string; kind: 'info' | 'error' }

type ToastState = {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, kind = 'info') => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
    // Errors stay until dismissed; other toasts hide after 6 s.
    if (kind !== 'error') {
      setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), 6000)
    }
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
