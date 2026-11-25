import type { ReactNode } from 'react'

/** A keyboard shortcut hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-line-strong bg-surface-2 px-1 font-mono text-[11px] font-medium text-muted">
      {children}
    </kbd>
  )
}
