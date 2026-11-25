import { useId, type InputHTMLAttributes } from 'react'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
}

/** A labelled input with its error under it (role="alert"). */
export function TextField({ label, error, id, className, ...rest }: TextFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const errorId = `${inputId}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={inputId}
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
