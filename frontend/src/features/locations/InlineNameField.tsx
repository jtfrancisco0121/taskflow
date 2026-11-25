import { useRef, useState } from 'react'
import { messageOf } from '../../api/errors'

type InlineNameFieldProps = {
  label: string
  initial?: string
  /** Shows a Private checkbox (create only). */
  withPrivate?: boolean
  pending?: boolean
  error?: unknown
  onSave: (name: string, isPrivate: boolean) => void
  onCancel: () => void
}

/** Inline create/rename: Enter saves, Escape cancels, blur saves if non-empty, empty is refused. */
export function InlineNameField({
  label,
  initial = '',
  withPrivate,
  pending,
  error,
  onSave,
  onCancel,
}: InlineNameFieldProps) {
  const [value, setValue] = useState(initial)
  const [isPrivate, setIsPrivate] = useState(false)
  const done = useRef(false)

  function save() {
    const name = value.trim()
    if (!name || pending) return
    if (name === initial.trim() && !withPrivate) {
      onCancel()
      return
    }
    onSave(name, isPrivate)
  }

  return (
    <div
      className="py-1 pr-1 pl-6"
      onBlur={(event) => {
        // Moving to the Private checkbox is not leaving the field.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        if (done.current || pending) return
        if (value.trim()) save()
        else onCancel()
      }}
    >
      <input
        autoFocus
        aria-label={label}
        value={value}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            done.current = true
            onCancel()
          }
        }}
        className="w-full rounded border border-line-strong px-1.5 py-0.5 text-sm focus:outline-2 focus:outline-focus-ring"
      />
      {withPrivate && (
        <label className="mt-1 flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          Private
        </label>
      )}
      {pending && (
        <p role="status" className="text-xs text-muted">
          Saving…
        </p>
      )}
      {error != null && (
        <p role="alert" className="text-xs text-danger">
          {messageOf(error)}
        </p>
      )}
    </div>
  )
}
