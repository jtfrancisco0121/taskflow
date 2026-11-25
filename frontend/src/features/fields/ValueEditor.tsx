import { useId, useState } from 'react'
import type { FieldView } from '../../api/types'
import { toApiDate, toInputDay } from '../../shared/dates'
import { Select } from '../../shared/ui/Select'
import { isEmpty } from './format'
import { PeopleEditor } from './People'

export type ValueEditorProps = {
  field: FieldView
  value: unknown
  /** Accessible name, for example "Customer tier for TF-12". */
  label: string
  /** Commit a new value; {@code null} clears. Called once per edit (Enter, blur or a pick). */
  onCommit: (value: unknown) => void
  disabled?: boolean
  /** The Workspace, for the member picker of a People field. */
  workspaceId?: string
  autoFocus?: boolean
  /** Called when an open editor is dismissed without a change (Escape). */
  onCancel?: () => void
}

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-blue-600'

/**
 * One draft-then-commit text control for the typed-in types. Enter or blur commits, Escape cancels.
 * What the user typed is committed as is when it is not valid for the type (a non-numeric text for a
 * Number), so the server's message says why (400 field.invalid_value) instead of the UI guessing.
 */
function TypedInput({
  field,
  value,
  label,
  onCommit,
  disabled,
  autoFocus,
  onCancel,
  parse,
  inputMode,
  long,
}: ValueEditorProps & {
  parse: (text: string) => unknown
  inputMode?: 'decimal' | 'numeric' | 'text' | 'url' | 'email'
  long?: boolean
}) {
  const id = useId()
  const shown = isEmpty(value) ? '' : String(value)
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text === shown) return
    onCommit(text === '' ? null : parse(text))
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setDraft(null)
      onCancel?.()
    } else if (event.key === 'Enter' && !(long && event.shiftKey)) {
      event.preventDefault()
      commit()
    }
  }
  const common = {
    id,
    'aria-label': label,
    value: draft ?? shown,
    disabled,
    autoFocus,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    onBlur: commit,
    onKeyDown,
    className: inputClass,
    'data-field': field.id,
  }
  return long ? (
    <textarea rows={3} {...common} />
  ) : (
    <input type="text" inputMode={inputMode} {...common} />
  )
}

/** The editor for each type (AD-12). */
export function ValueEditor(props: ValueEditorProps) {
  const { field, value, label, onCommit, disabled } = props
  switch (field.type) {
    case 'TEXT':
      return <TypedInput {...props} parse={(t) => t} />
    case 'LONG_TEXT':
      return <TypedInput {...props} parse={(t) => t} long />
    case 'URL':
      return <TypedInput {...props} parse={(t) => t} inputMode="url" />
    case 'EMAIL':
      return <TypedInput {...props} parse={(t) => t} inputMode="email" />
    case 'NUMBER':
    case 'PROGRESS':
      return (
        <TypedInput
          {...props}
          inputMode="decimal"
          parse={(t) =>
            Number.isFinite(Number(t.replace(',', '.'))) ? Number(t.replace(',', '.')) : t
          }
        />
      )
    case 'DATE':
      return (
        <input
          type="date"
          aria-label={label}
          disabled={disabled}
          autoFocus={props.autoFocus}
          value={toInputDay(typeof value === 'string' ? value : null)}
          onChange={(event) => onCommit(event.target.value ? toApiDate(event.target.value) : null)}
          className={inputClass}
        />
      )
    case 'DROPDOWN':
      return (
        <Select
          aria-label={label}
          disabled={disabled}
          autoFocus={props.autoFocus}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => onCommit(next === '' ? null : next)}
          options={[
            { value: '', label: '—' },
            ...(field.options ?? []).map((option) => ({
              value: option.id ?? '',
              label: option.name ?? '',
            })),
          ]}
        />
      )
    case 'LABELS': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div
          role="group"
          aria-label={label}
          className="flex max-h-28 flex-col gap-0.5 overflow-auto rounded border border-slate-300 bg-white p-1"
        >
          {field.options?.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(option.id!)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.id!]
                    : selected.filter((id) => id !== option.id)
                  onCommit(next.length === 0 ? null : next)
                }}
              />
              {option.name}
            </label>
          ))}
        </div>
      )
    }
    case 'PEOPLE':
      return (
        <PeopleEditor
          workspaceId={props.workspaceId}
          field={field}
          value={value}
          label={label}
          disabled={disabled}
          onCommit={onCommit}
        />
      )
    case 'CHECKBOX':
      return (
        <input
          type="checkbox"
          aria-label={label}
          disabled={disabled}
          autoFocus={props.autoFocus}
          checked={value === true}
          onChange={(event) => onCommit(event.target.checked ? true : null)}
        />
      )
    case 'RATING': {
      const max = typeof field.config?.max === 'number' ? field.config.max : 5
      const current = typeof value === 'number' ? value : 0
      return (
        <div role="group" aria-label={label} className="flex">
          {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
            <button
              key={star}
              type="button"
              disabled={disabled}
              aria-label={`${star} of ${max}`}
              aria-pressed={star <= current}
              // Clicking the current value clears it.
              onClick={() => onCommit(star === current ? null : star)}
              className={`px-0.5 text-lg ${star <= current ? 'text-amber-500' : 'text-slate-300'}`}
            >
              ★
            </button>
          ))}
        </div>
      )
    }
    default:
      return <span className="text-sm text-slate-500">This type can't be edited here yet.</span>
  }
}
