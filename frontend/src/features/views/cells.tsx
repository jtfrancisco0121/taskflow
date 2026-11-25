import { useState } from 'react'
import { toApiDate, toInputDay } from '../../shared/dates'
import { Select } from '../../shared/ui/Select'

/** Click to edit; Enter saves, Escape cancels and sends nothing, blur saves. */
export function EditableText({
  value,
  label,
  onSave,
  className = '',
  allowEmpty = false,
  children,
}: {
  value: string
  label: string
  onSave: (next: string) => void
  className?: string
  allowEmpty?: boolean
  children?: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <span className={className}>
        {children ?? value}
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className="ml-1 text-xs text-slate-400 hover:text-slate-700"
          onClick={(e) => {
            e.stopPropagation()
            setDraft(value)
            setEditing(true)
          }}
        >
          ✎
        </button>
      </span>
    )
  }
  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if ((next || allowEmpty) && next !== value) onSave(next)
  }
  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      className="w-full rounded border border-blue-400 px-1 py-0.5"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setEditing(false)
        }
      }}
    />
  )
}

export function SelectCell({
  value,
  label,
  options,
  onChange,
}: {
  value: string
  label: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      className="max-w-full border-transparent bg-transparent px-1 hover:border-line-strong"
      onValueChange={(next) => next !== value && onChange(next)}
      options={options}
      placeholder="—"
    />
  )
}

/** A day picker; the value is sent as that day at 00:00 UTC (decision 003.4). */
export function DateCell({
  value,
  label,
  onChange,
}: {
  value: string | null | undefined
  label: string
  onChange: (next: string | null) => void
}) {
  return (
    <input
      type="date"
      aria-label={label}
      value={toInputDay(value)}
      className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-300"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value ? toApiDate(e.target.value) : null)}
    />
  )
}

export function MultiPickCell({
  label,
  options,
  selected,
  onChange,
  summary,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onChange: (next: string[]) => void
  summary: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary aria-label={label} className="cursor-pointer list-none text-sm">
        {summary}
      </summary>
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-48 overflow-auto rounded border border-slate-200 bg-white p-2 shadow">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, o.value]
                      : selected.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </details>
  )
}

export function TagsCell({
  tags,
  label,
  onChange,
}: {
  tags: string[]
  label: string
  onChange: (next: string[]) => void
}) {
  return (
    <EditableText
      allowEmpty
      value={tags.join(', ')}
      label={label}
      onSave={(text) =>
        onChange(
          text
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        )
      }
    >
      {tags.length ? tags.join(', ') : <span className="text-slate-400">—</span>}
    </EditableText>
  )
}
