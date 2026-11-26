import { useState } from 'react'
import { messageOf } from '../../api/errors'
import type { StatusInfo } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Select } from '../../shared/ui/Select'
import { Skeleton } from '../../shared/ui/Skeleton'
import { resolveRemap } from './buildRemap'
import { useLocationStatuses } from './useLocationStatuses'
import { useResetStatuses } from './useStatusMutations'

type ResetPanelProps = {
  workspaceId: string
  locationId: string
  parentId: string
  /** The location's own statuses; every one of them is retired by a reset. */
  own: StatusInfo[]
  onCancel: () => void
  onDone: () => void
}

/** FR-24: "Reset to inherited" asks only about own statuses that have no same-name inherited one. */
export function ResetPanel({
  workspaceId,
  locationId,
  parentId,
  own,
  onCancel,
  onDone,
}: ResetPanelProps) {
  const inherited = useLocationStatuses(workspaceId, parentId)
  const reset = useResetStatuses(workspaceId, locationId)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const targets = (inherited.data?.statuses ?? []).map((status) => ({
    key: status.id ?? '',
    name: status.name ?? '',
  }))
  const resolution = resolveRemap(own, targets, choices)
  const ready = inherited.isSuccess && resolution.unresolved.length === 0

  if (inherited.isPending) {
    return (
      <div role="status" aria-label="Loading statuses" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    )
  }
  if (inherited.isError) {
    return (
      <ErrorState message={messageOf(inherited.error)} onRetry={() => void inherited.refetch()} />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg">
        Reset to the inherited set? This location will use the statuses of its parent again.
      </p>
      {resolution.needsChoice.length > 0 && (
        <fieldset className="rounded-md border border-line bg-warn-soft p-2">
          <legend className="px-1 text-sm font-medium text-fg">Move its tasks to</legend>
          {resolution.needsChoice.map((status) => (
            <label key={status.id} className="mb-1 flex items-center gap-2 text-sm text-fg">
              <span className="w-40 truncate">{status.name}</span>
              <Select
                aria-label={`Move tasks from ${status.name} to`}
                value={choices[status.id ?? ''] ?? ''}
                onValueChange={(next) => setChoices((all) => ({ ...all, [status.id ?? '']: next }))}
                options={targets.map((target) => ({ value: target.key, label: target.name }))}
                placeholder="Choose a status"
              />
            </label>
          ))}
        </fieldset>
      )}
      {reset.isError && (
        <p role="alert" className="text-sm text-danger">
          {messageOf(reset.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="danger"
          disabled={!ready || reset.isPending}
          onClick={() => reset.mutate(resolution.remap, { onSuccess: onDone })}
        >
          Reset to inherited
        </Button>
      </div>
    </div>
  )
}
