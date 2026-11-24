import { useState, type FormEvent } from 'react'
import { ApiError, messageOf } from '../../api/errors'
import type { FieldView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { TextField } from '../../shared/ui/TextField'
import { CREATABLE_TYPES, FIELD_TYPES, OPTION_COLORS, PALETTE, type FieldType } from './fieldTypes'
import { useCreateField, useUpdateField, type CreateFieldBody } from './useFieldMutations'

type Draft = { key: string; id?: string; name: string; color: string }

type FieldEditorProps = {
  workspaceId: string
  locationId: string
  /** The field being edited; absent when creating. */
  field?: FieldView
  onCancel: () => void
  onSaved: () => void
}

const input =
  'rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-2 focus:outline-blue-600'

function numberConfig(field: FieldView | undefined, key: string, fallback: number): number {
  const value = field?.config?.[key]
  return typeof value === 'number' ? value : fallback
}

/** Name, type (create only), config by type, and the Options of Dropdown and Labels fields. */
export function FieldEditor({
  workspaceId,
  locationId,
  field,
  onCancel,
  onSaved,
}: FieldEditorProps) {
  const create = useCreateField(workspaceId, locationId)
  const update = useUpdateField(workspaceId)
  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState<FieldType>(field?.type ?? 'TEXT')
  const [decimals, setDecimals] = useState(numberConfig(field, 'decimals', 0))
  const [max, setMax] = useState(numberConfig(field, 'max', 5))
  const [options, setOptions] = useState<Draft[]>(
    (field?.options ?? []).map((option) => ({
      key: option.id ?? crypto.randomUUID(),
      id: option.id,
      name: option.name ?? '',
      color: option.color ?? 'gray',
    })),
  )
  const [error, setError] = useState<{ field: 'name' | 'form'; message: string } | null>(null)
  const pending = create.isPending || update.isPending
  const editing = field !== undefined

  function addOption() {
    setOptions((rows) => [
      ...rows,
      { key: crypto.randomUUID(), name: '', color: PALETTE[rows.length % PALETTE.length] },
    ])
  }
  function patchOption(index: number, patch: Partial<Draft>) {
    setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function moveOption(index: number, delta: number) {
    setOptions((rows) => {
      const target = index + delta
      if (target < 0 || target >= rows.length) return rows
      const next = [...rows]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function config() {
    if (type === 'NUMBER') return { decimals }
    if (type === 'RATING') return { max }
    return undefined
  }

  function onError(err: unknown) {
    if (err instanceof ApiError && err.code === 'field.name_taken') {
      setError({ field: 'name', message: `'${name.trim()}' is already used on this branch.` })
    } else if (err instanceof ApiError && err.code === 'field.stale') {
      setError({
        field: 'form',
        message: 'Someone else changed this field. Review and save again.',
      })
    } else if (err instanceof ApiError && err.code === 'field.option_name_taken') {
      setError({ field: 'form', message: 'Option names must be different from each other.' })
    } else {
      setError({ field: 'form', message: messageOf(err) })
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError({ field: 'name', message: 'Give the field a name.' })
      return
    }
    if (trimmed.length > 50) {
      setError({ field: 'name', message: 'A field name is at most 50 characters.' })
      return
    }
    if (FIELD_TYPES[type].hasOptions && options.some((o) => !o.name.trim())) {
      setError({ field: 'form', message: 'Every Option needs a name.' })
      return
    }
    const optionBody = FIELD_TYPES[type].hasOptions
      ? options.map((o) => ({ id: o.id, name: o.name.trim(), color: o.color }))
      : undefined
    if (field?.id) {
      update.mutate(
        {
          id: field.id,
          version: field.version ?? 1,
          body: { name: trimmed, config: config(), options: optionBody },
        },
        { onSuccess: onSaved, onError },
      )
    } else {
      const body: CreateFieldBody = {
        name: trimmed,
        type,
        config: config(),
        options: optionBody,
      }
      create.mutate(body, { onSuccess: onSaved, onError })
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="Field editor">
      <TextField
        label="Name"
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        error={error?.field === 'name' ? error.message : undefined}
        autoFocus
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="field-type" className="text-sm font-medium">
          Field type
        </label>
        <select
          id="field-type"
          className={input}
          value={type}
          disabled={editing}
          onChange={(event) => setType(event.target.value as FieldType)}
        >
          {(editing ? [type] : CREATABLE_TYPES).map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPES[t].label}
            </option>
          ))}
        </select>
        {editing && <p className="text-xs text-slate-500">The type can't change after creation.</p>}
      </div>
      {type === 'NUMBER' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="field-decimals" className="text-sm font-medium">
            Decimals shown
          </label>
          <select
            id="field-decimals"
            className={input}
            value={decimals}
            onChange={(event) => setDecimals(Number(event.target.value))}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
      {type === 'RATING' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="field-max" className="text-sm font-medium">
            Number of stars
          </label>
          <select
            id="field-max"
            className={input}
            value={max}
            onChange={(event) => setMax(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
      {FIELD_TYPES[type].hasOptions && (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-medium">Options</legend>
          {options.length === 0 && (
            <p className="text-sm text-slate-500">
              No Options yet. Add the choices people can pick.
            </p>
          )}
          {options.map((option, index) => (
            <div key={option.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: OPTION_COLORS[option.color] }}
              />
              <input
                aria-label={`Option ${index + 1} name`}
                className={`${input} min-w-0 flex-1`}
                value={option.name}
                maxLength={60}
                onChange={(event) => patchOption(index, { name: event.target.value })}
              />
              <select
                aria-label={`Option ${index + 1} color`}
                className={input}
                value={option.color}
                onChange={(event) => patchOption(index, { color: event.target.value })}
              >
                {PALETTE.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <Button
                aria-label={`Move option ${index + 1} up`}
                disabled={index === 0}
                onClick={() => moveOption(index, -1)}
              >
                Up
              </Button>
              <Button
                aria-label={`Move option ${index + 1} down`}
                disabled={index === options.length - 1}
                onClick={() => moveOption(index, 1)}
              >
                Down
              </Button>
              <Button
                aria-label={`Remove option ${index + 1}`}
                onClick={() => setOptions((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
          {editing && (
            <p className="text-xs text-slate-500">
              Removing an Option: tasks with it will show this field as empty. Values stay saved.
            </p>
          )}
          <div>
            <Button onClick={addOption}>Add option</Button>
          </div>
        </fieldset>
      )}
      {error?.field === 'form' && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save field' : 'Create field'}
        </Button>
      </div>
    </form>
  )
}
