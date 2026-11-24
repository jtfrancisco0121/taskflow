import type { ReactNode } from 'react'

export type Hint = { state: 'saving' | 'saved' | 'error'; message?: string }

type FieldShellProps = {
  label: string
  htmlFor?: string
  hint?: Hint
  children: ReactNode
  as?: 'label' | 'legend'
}

/** A labelled field with its "Saving…" / "Saved" hint (aria-live) and refusal message under it. */
export function FieldShell({ label, htmlFor, hint, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <span aria-live="polite" className="text-xs text-slate-500">
          {hint?.state === 'saving' ? 'Saving…' : hint?.state === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {children}
      {hint?.state === 'error' && (
        <p role="alert" className="text-xs text-red-700">
          {hint.message}
        </p>
      )}
    </div>
  )
}
