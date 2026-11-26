import type { ReactNode } from 'react'

export type Hint = { state: 'saving' | 'saved' | 'error'; message?: string }

type FieldShellProps = {
  label: string
  /** The id of the input the label names; a Picker field has none (its trigger carries the name). */
  htmlFor?: string
  hint?: Hint
  children: ReactNode
}

/** A labelled field with its "Saving…" / "Saved" hint (aria-live) and refusal message under it. */
export function FieldShell({ label, htmlFor, hint, children }: FieldShellProps) {
  const labelClass = 'text-xs font-medium text-muted'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        )}
        <span aria-live="polite" className="text-xs text-muted">
          {hint?.state === 'saving' ? 'Saving…' : hint?.state === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {children}
      {hint?.state === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {hint.message}
        </p>
      )}
    </div>
  )
}
