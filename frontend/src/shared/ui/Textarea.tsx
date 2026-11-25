import { useId, type TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  error?: string
}

/** A labelled textarea with its error under it (role="alert"), like TextField. */
export function Textarea({ label, error, id, className, ...rest }: TextareaProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const errorId = `${fieldId}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`rounded-md border bg-surface px-2 py-1.5 text-[13px] text-fg placeholder:text-faint ${error ? 'border-danger' : 'border-line-strong'} ${className ?? ''}`}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
