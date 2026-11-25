import { useEffect, useRef, useState } from 'react'
import type { FieldView, TaskView } from '../../api/types'
import { isWithinHost } from '../../shared/ui/isWithinHost'
import { ValueCell, ValueEditor, formatValue, isEmpty } from '../fields'
import { useTaskActions } from './useTaskActions'

/**
 * A custom field cell of the List and Table (AD-8, AD-12): the value as text, a click, Enter or F2
 * opens the type's editor in place, Enter or blur commits, Escape cancels. A checkbox has no edit
 * mode. One commit is one optimistic task update; a spinner shows after 300 ms.
 */
export function FieldCell({ field, task }: { field: FieldView; task: TaskView }) {
  const actions = useTaskActions()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const value = (task.customFields as Record<string, unknown> | undefined)?.[field.id!]
  const label = `${field.name} for ${task.readableId}`

  useEffect(() => () => clearTimeout(timer.current), [])

  // A multi-pick editor stays open so several picks can be made; it closes on blur or Escape.
  const multi = field.type === 'LABELS' || field.type === 'PEOPLE'

  async function commit(next: unknown) {
    if (!multi) setEditing(false)
    timer.current = setTimeout(() => setSaving(true), 300)
    try {
      await actions.setCustomField(task, field.id!, next)
    } finally {
      clearTimeout(timer.current)
      setSaving(false)
    }
    if (!multi) button.current?.focus()
  }

  if (field.type === 'CHECKBOX') {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <ValueEditor
          field={field}
          value={value}
          label={label}
          workspaceId={task.workspaceId}
          onCommit={(next) => void commit(next)}
        />
      </span>
    )
  }
  if (editing) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          // A library Select's listbox is portalled, so focus moving into it is not leaving the editor (AD-12).
          if (!isWithinHost(e.currentTarget, e.relatedTarget)) setEditing(false)
        }}
        onKeyDown={(e) => {
          // An Escape that closed a library Select's listbox is already handled (defaultPrevented).
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.stopPropagation()
            setEditing(false)
            button.current?.focus()
          }
        }}
      >
        <ValueEditor
          field={field}
          value={value}
          label={label}
          workspaceId={task.workspaceId}
          autoFocus
          onCommit={(next) => void commit(next)}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }
  const text = isEmpty(value) ? 'empty' : formatValue(field, value)
  return (
    <button
      ref={button}
      type="button"
      aria-label={`${field.name}: ${text}`}
      aria-busy={saving || undefined}
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault()
          setEditing(true)
        }
      }}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-sm hover:bg-slate-100 focus:outline-2 focus:outline-blue-600"
    >
      <ValueCell field={field} value={value} workspaceId={task.workspaceId} />
      {saving && (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
        />
      )}
    </button>
  )
}
