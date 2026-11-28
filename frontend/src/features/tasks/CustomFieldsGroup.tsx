import { useState } from 'react'
import { messageOf } from '../../api/errors'
import type { TaskView } from '../../api/types'
import { ValueEditor, useLocationFields } from '../fields'
import { FieldShell, type Hint } from './FieldShell'
import type { TaskPatch } from './useUpdateTask'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

type Save = (field: string, label: string, patch: TaskPatch) => Promise<boolean>

type Props = {
  task: TaskView
  hints: Record<string, Hint | undefined>
  save: Save
}

/** The task's effective custom fields, each with where it comes from and an editor (CAP-4, CAP-7). */
export function CustomFieldsGroup({ task, hints, save }: Props) {
  const fields = useLocationFields(task.listId)
  const shown = (fields.data?.fields ?? []).filter((f) => !f.hidden)
  const values = (task.customFields ?? {}) as Record<string, unknown>
  // The value shown while its save is in flight; when the save ends it is dropped, so a refusal rolls back.
  const [pending, setPending] = useState<Record<string, { value: unknown }>>({})

  function commit(id: string, name: string, value: unknown) {
    setPending((all) => ({ ...all, [id]: { value } }))
    void save(`cf:${id}`, name, { customFields: { [id]: value } }).finally(() =>
      setPending((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id))),
    )
  }

  return (
    <section aria-labelledby="custom-fields-heading" className="flex flex-col gap-3">
      <h3 id="custom-fields-heading" className="text-xs font-semibold uppercase text-muted">
        Custom fields
      </h3>
      {fields.isPending && (
        <div
          role="status"
          aria-label="Loading custom fields"
          className="flex animate-pulse flex-col gap-2"
        >
          <div className="h-8 rounded bg-surface-3" />
          <div className="h-8 rounded bg-surface-3" />
        </div>
      )}
      {refreshFailed(fields) && (
        <RefreshNotice message={messageOf(fields.error)} onRetry={() => void fields.refetch()} />
      )}
      {loadFailed(fields) && (
        <p role="alert" className="text-sm text-danger">
          Couldn't load the custom fields: {messageOf(fields.error)}{' '}
          <button type="button" className="underline" onClick={() => void fields.refetch()}>
            Retry
          </button>
        </p>
      )}
      {hasData(fields) && shown.length === 0 && (
        <p className="text-sm text-muted">
          No custom fields here. Add one from the location's Fields.
        </p>
      )}
      {shown.map((field) => {
        const key = `cf:${field.id}`
        const label = `${field.name} for ${task.readableId}`
        return (
          <FieldShell key={field.id} label={field.name ?? ''} hint={hints[key]}>
            <ValueEditor
              field={field}
              value={field.id! in pending ? pending[field.id!].value : values[field.id!]}
              label={label}
              workspaceId={task.workspaceId}
              onCommit={(value) => commit(field.id!, field.name ?? 'custom field', value)}
            />
            <span id={`${key}-origin`} className="text-xs text-muted">
              from {field.definedAtName}
            </span>
          </FieldShell>
        )
      })}
    </section>
  )
}
