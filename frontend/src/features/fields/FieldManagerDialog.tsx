import { useState } from 'react'
import { messageOf } from '../../api/errors'
import type { FieldView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { FieldEditor } from './FieldEditor'
import { FIELD_TYPES, MAX_OWN_FIELDS, typeOf } from './fieldTypes'
import { OptionChip } from './OptionChip'
import { useHideField, useRetireField, useUpdateField } from './useFieldMutations'
import { useLocationFields } from './useLocationFields'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed, shownData } from '../../api/queryState'

export type FieldsLocation = {
  id: string
  name: string
  type: 'SPACE' | 'FOLDER' | 'LIST'
  parentId?: string | null
}

type FieldManagerDialogProps = {
  workspaceId: string
  location: FieldsLocation
  onClose: () => void
  restoreFocus?: () => HTMLElement | null
}

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; field: FieldView }

function TypeBadge({ field }: { field: FieldView }) {
  const entry = FIELD_TYPES[typeOf(field)]
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span aria-hidden="true" className="font-mono">
        {entry.icon}
      </span>
      {entry.label}
    </span>
  )
}

/** UX spine: "Fields here" (own, editable) and "Inherited" (from <Location>, hide or unhide). */
export function FieldManagerDialog({
  workspaceId,
  location,
  onClose,
  restoreFocus,
}: FieldManagerDialogProps) {
  const fields = useLocationFields(location.id)
  const update = useUpdateField(workspaceId)
  const retire = useRetireField(workspaceId)
  const hide = useHideField(workspaceId, location.id)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [retiring, setRetiring] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const all = shownData(fields)?.fields ?? []
  const own = all.filter((f) => !f.inherited)
  const inherited = all.filter((f) => f.inherited)
  const canEdit = shownData(fields)?.canEdit === true
  const atLimit = own.length >= MAX_OWN_FIELDS

  function fail(error: unknown) {
    setActionError(messageOf(error))
  }

  function move(field: FieldView, index: number, delta: -1 | 1) {
    const neighbour = own[index + delta]
    if (!field.id || !neighbour?.id) return
    setActionError(null)
    update.mutate(
      {
        id: field.id,
        version: field.version ?? 1,
        body: delta < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id },
      },
      {
        onSuccess: () => setAnnounce(`${field.name} moved to position ${index + delta + 1}`),
        onError: fail,
      },
    )
  }

  function onRowKey(event: React.KeyboardEvent, field: FieldView, index: number) {
    if (!canEdit || !event.altKey) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(field, index, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const back = () => setMode({ kind: 'list' })

  return (
    <Dialog title={`Fields: ${location.name}`} onClose={onClose} restoreFocus={restoreFocus} wide>
      {mode.kind === 'create' && (
        <FieldEditor
          workspaceId={workspaceId}
          locationId={location.id}
          onCancel={back}
          onSaved={back}
        />
      )}
      {mode.kind === 'edit' && (
        <FieldEditor
          workspaceId={workspaceId}
          locationId={location.id}
          field={mode.field}
          onCancel={back}
          onSaved={back}
        />
      )}
      {mode.kind === 'list' && (
        <div className="flex flex-col gap-4">
          {fields.isPending && (
            <div role="status" aria-label="Loading fields" className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {refreshFailed(fields) && (
            <RefreshNotice
              message={messageOf(fields.error)}
              onRetry={() => void fields.refetch()}
            />
          )}
          {loadFailed(fields) && (
            <ErrorState message={messageOf(fields.error)} onRetry={() => void fields.refetch()} />
          )}
          {hasData(fields) && (
            <>
              {!canEdit && (
                <p className="rounded-md bg-surface-2 px-2 py-1 text-[13px] text-muted">
                  Only members who can edit {location.name} can change its fields.
                </p>
              )}
              {actionError && (
                <p role="alert" className="text-[13px] text-danger">
                  {actionError}
                </p>
              )}
              <section aria-labelledby="fields-here" className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 id="fields-here" className="font-display text-sm font-semibold">
                    Fields here
                  </h3>
                  {canEdit && (
                    <Button
                      variant="primary"
                      disabled={atLimit}
                      title={
                        atLimit
                          ? `A location can define up to ${MAX_OWN_FIELDS} fields.`
                          : undefined
                      }
                      onClick={() => setMode({ kind: 'create' })}
                    >
                      New field
                    </Button>
                  )}
                </div>
                {own.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    No fields here yet. Fields you add apply to every task below {location.name}.
                  </p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {own.map((field, index) => (
                      <li
                        key={field.id}
                        onKeyDown={(event) => onRowKey(event, field, index)}
                        className="flex flex-col gap-1 rounded-md border border-line bg-surface px-2 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-[13px] font-medium text-fg">
                            {field.name}
                          </span>
                          <TypeBadge field={field} />
                          {canEdit && retiring !== field.id && (
                            <>
                              <Button
                                aria-label={`Move ${field.name} up`}
                                disabled={index === 0 || update.isPending}
                                onClick={() => move(field, index, -1)}
                              >
                                Up
                              </Button>
                              <Button
                                aria-label={`Move ${field.name} down`}
                                disabled={index === own.length - 1 || update.isPending}
                                onClick={() => move(field, index, 1)}
                              >
                                Down
                              </Button>
                              <Button
                                aria-label={`Edit ${field.name}`}
                                onClick={() => setMode({ kind: 'edit', field })}
                              >
                                Edit
                              </Button>
                              <Button
                                aria-label={`Retire ${field.name}`}
                                onClick={() => setRetiring(field.id ?? null)}
                              >
                                Retire
                              </Button>
                            </>
                          )}
                        </div>
                        {(field.options ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {field.options?.map((option) => (
                              <OptionChip
                                key={option.id}
                                name={option.name ?? ''}
                                color={option.color}
                              />
                            ))}
                          </div>
                        )}
                        {retiring === field.id && (
                          <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg">
                            <span>
                              Retire {field.name}? It disappears from every task below. Saved values
                              are kept.
                            </span>
                            <Button
                              variant="danger"
                              disabled={retire.isPending}
                              onClick={() => {
                                setActionError(null)
                                retire.mutate(
                                  { id: field.id!, version: field.version ?? 1 },
                                  { onSuccess: () => setRetiring(null), onError: fail },
                                )
                              }}
                            >
                              Retire field
                            </Button>
                            <Button onClick={() => setRetiring(null)}>Keep</Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {location.type !== 'SPACE' && (
                <section aria-labelledby="fields-inherited" className="flex flex-col gap-2">
                  <h3 id="fields-inherited" className="font-display text-sm font-semibold">
                    Inherited
                  </h3>
                  {inherited.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      Nothing is inherited. Fields defined on a parent location show here.
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {inherited.map((field) => (
                        <li
                          key={field.id}
                          className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5"
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="text-[13px] font-medium text-fg">{field.name}</span>
                            <span className="text-xs text-muted">from {field.definedAtName}</span>
                            {field.hidden && (
                              <span className="text-xs text-muted">
                                Hidden here. Tasks in {location.name} won't show {field.name}.
                              </span>
                            )}
                          </div>
                          <TypeBadge field={field} />
                          {canEdit && (
                            <Button
                              aria-label={`${field.hidden ? 'Unhide' : 'Hide'} ${field.name}`}
                              disabled={hide.isPending}
                              onClick={() => {
                                setActionError(null)
                                hide.mutate(
                                  { fieldId: field.id!, hidden: !field.hidden },
                                  { onError: fail },
                                )
                              }}
                            >
                              {field.hidden ? 'Unhide' : 'Hide'}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
          <p role="status" className="sr-only">
            {announce}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
