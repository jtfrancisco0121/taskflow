import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { messageOf } from '../../api/errors'
import type { StatusInfo } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Select } from '../../shared/ui/Select'
import { draftTargets, removedStatuses, resolveRemap } from './buildRemap'
import { statusSetSchema, type StatusSetForm } from './statusSchema'
import { COLOR_PRESETS, GROUPS, GROUP_LABEL, type DraftRow, type Group } from './statusTypes'
import { useReplaceStatuses } from './useStatusMutations'

type StatusEditorProps = {
  workspaceId: string
  locationId: string
  current: StatusInfo[]
  /** The location has no own set yet: saving creates one and every inherited status is replaced. */
  inheriting: boolean
  onCancel: () => void
  onSaved: () => void
}

const input =
  'rounded border border-slate-300 px-1.5 py-1 text-sm focus:outline-2 focus:outline-blue-600'

export function StatusEditor({
  workspaceId,
  locationId,
  current,
  inheriting,
  onCancel,
  onSaved,
}: StatusEditorProps) {
  const replace = useReplaceStatuses(workspaceId, locationId)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const form = useForm<StatusSetForm>({
    resolver: zodResolver(statusSetSchema),
    mode: 'onChange',
    defaultValues: {
      statuses: current.map((status): DraftRow => ({
        key: status.id ?? crypto.randomUUID(),
        // A first own set sends no ids: the inherited ids belong to another location.
        id: inheriting ? undefined : status.id,
        name: status.name ?? '',
        group: (status.group ?? 'NOT_STARTED') as Group,
        color: status.color ?? '#9ca3af',
      })),
    },
  })
  const { fields, move, remove, append } = useFieldArray({
    control: form.control,
    name: 'statuses',
    keyName: 'fieldKey',
  })
  const drafts = useWatch({ control: form.control, name: 'statuses' }) as DraftRow[]
  const parsed = statusSetSchema.safeParse({ statuses: drafts })
  const issues = parsed.success ? [] : parsed.error.issues
  const rowError = (index: number) =>
    issues.find((issue) => issue.path[1] === index && issue.path[2] === 'name')?.message ??
    issues.find((issue) => issue.path[1] === index)?.message
  const setError = issues.find((issue) => issue.path.length === 1)?.message

  const removed = removedStatuses(current, drafts, inheriting)
  const resolution = resolveRemap(removed, draftTargets(drafts), choices)
  const canSave = parsed.success && resolution.unresolved.length === 0 && !replace.isPending

  const save = form.handleSubmit((values) => {
    replace.mutate(
      {
        statuses: values.statuses.map((status) => ({
          ...(status.id ? { id: status.id } : {}),
          name: status.name.trim(),
          group: status.group,
          color: status.color.toLowerCase(),
        })),
        // `to` is the target status NAME; only removed statuses get an entry.
        remap: resolution.remap,
      },
      { onSuccess: onSaved },
    )
  })

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      {inheriting && (
        <p className="text-sm text-slate-600">
          Saving creates a set of its own for this location. It starts as a copy of the inherited
          one.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {fields.map((field, index) => {
          const n = index + 1
          const color = drafts[index]?.color ?? field.color
          return (
            <li key={field.fieldKey} className="rounded border border-slate-200 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Status ${n} name`}
                  className={`${input} w-40`}
                  {...form.register(`statuses.${index}.name`)}
                />
                <Controller
                  control={form.control}
                  name={`statuses.${index}.group`}
                  render={({ field: group }) => (
                    <Select
                      aria-label={`Status ${n} group`}
                      value={group.value}
                      onValueChange={group.onChange}
                      options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
                    />
                  )}
                />
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full border border-slate-300"
                  style={{ backgroundColor: color }}
                />
                <input
                  aria-label={`Status ${n} color`}
                  className={`${input} w-24 font-mono`}
                  {...form.register(`statuses.${index}.color`)}
                />
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move status ${n} up`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                    className="rounded border px-1.5 disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move status ${n} down`}
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, index + 1)}
                    className="rounded border px-1.5 disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove status ${n}`}
                    disabled={fields.length <= 1}
                    onClick={() => remove(index)}
                    className="rounded border px-1.5 disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div
                className="mt-1 flex gap-1"
                role="group"
                aria-label={`Status ${n} color presets`}
              >
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`Status ${n} color ${preset}`}
                    onClick={() =>
                      form.setValue(`statuses.${index}.color`, preset, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    className={`h-4 w-4 rounded-full border ${color.toLowerCase() === preset ? 'ring-2 ring-blue-600' : 'border-slate-300'}`}
                    style={{ backgroundColor: preset }}
                  />
                ))}
              </div>
              {rowError(index) && (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {rowError(index)}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div>
        <Button
          onClick={() =>
            append({
              key: crypto.randomUUID(),
              name: '',
              group: 'ACTIVE',
              color: COLOR_PRESETS[1],
            })
          }
        >
          Add status
        </Button>
      </div>
      {resolution.needsChoice.length > 0 && (
        <fieldset className="rounded border border-amber-200 bg-amber-50 p-2">
          <legend className="px-1 text-sm font-medium">Move its tasks to</legend>
          {resolution.needsChoice.map((status) => (
            <label key={status.id} className="mb-1 flex items-center gap-2 text-sm">
              <span className="w-40 truncate">{status.name}</span>
              <Select
                aria-label={`Move tasks from ${status.name} to`}
                value={resolution.chosen[status.id ?? '']?.key ?? ''}
                onValueChange={(next) => setChoices((all) => ({ ...all, [status.id ?? '']: next }))}
                options={drafts
                  .filter((draft) => draft.name.trim())
                  .map((draft) => ({ value: draft.key, label: draft.name.trim() }))}
                placeholder="Choose a status"
              />
            </label>
          ))}
        </fieldset>
      )}
      {setError && (
        <p role="alert" className="text-sm text-red-700">
          {setError}
        </p>
      )}
      {replace.isError && (
        <p role="alert" className="text-sm text-red-700">
          {messageOf(replace.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  )
}
