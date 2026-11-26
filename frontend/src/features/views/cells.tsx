import { useState } from 'react'

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
