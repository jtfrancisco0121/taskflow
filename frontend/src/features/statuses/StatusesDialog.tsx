import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { StatusPill } from '../../shared/ui/StatusPill'
import { GROUP_LABEL, type Group } from './statusTypes'
import { ResetPanel } from './ResetPanel'
import { StatusEditor } from './StatusEditor'
import { useLocationStatuses } from './useLocationStatuses'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed, shownData } from '../../api/queryState'

export type StatusesLocation = {
  id: string
  name: string
  type: 'SPACE' | 'FOLDER' | 'LIST'
  parentId?: string | null
}

type StatusesDialogProps = {
  workspaceId: string
  location: StatusesLocation
  onClose: () => void
  restoreFocus?: () => HTMLElement | null
}

const TYPE_NAME = { SPACE: 'Space', FOLDER: 'Folder', LIST: 'List' } as const

/** The Location that defines an inherited set, named from GET /locations/{id}. */
function useSourceName(sourceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.location(sourceId ?? ''),
    enabled: !!sourceId,
    queryFn: () =>
      unwrap(api.GET('/api/v1/locations/{id}', { params: { path: { id: sourceId! } } })),
  }).data?.name
}

/** FR-22 to FR-24: see, edit and reset a Location's status set. */
export function StatusesDialog({
  workspaceId,
  location,
  onClose,
  restoreFocus,
}: StatusesDialogProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reset'>('view')
  const set = useLocationStatuses(workspaceId, location.id)
  const inheritedFrom = shownData(set)?.inheritedFrom ?? null
  const sourceName = useSourceName(inheritedFrom)
  const statuses = shownData(set)?.statuses ?? []
  const inheriting = inheritedFrom !== null
  const canReset = location.type !== 'SPACE' && !inheriting && !!location.parentId

  return (
    <Dialog title={`Statuses: ${location.name}`} onClose={onClose} restoreFocus={restoreFocus} wide>
      {set.isPending && (
        <div role="status" aria-label="Loading statuses" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      )}
      {refreshFailed(set) && (
        <RefreshNotice message={messageOf(set.error)} onRetry={() => void set.refetch()} />
      )}
      {loadFailed(set) && (
        <ErrorState message={messageOf(set.error)} onRetry={() => void set.refetch()} />
      )}
      {hasData(set) && (
        <div className="flex flex-col gap-3">
          <p className="rounded-md bg-surface-2 px-2 py-1 text-sm text-muted">
            {inheriting ? `Inherited from ${sourceName ?? 'a parent location'}` : 'Defined here'}
          </p>
          {mode === 'view' && (
            <>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {statuses.map((status) => (
                  <li key={status.id} className="flex items-center gap-2 text-sm">
                    <StatusPill name={status.name ?? ''} color={status.color} />
                    <span className="text-faint">
                      {GROUP_LABEL[(status.group ?? 'NOT_STARTED') as Group]}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  {canReset && <Button onClick={() => setMode('reset')}>Reset to inherited</Button>}
                </div>
                <div className="flex gap-2">
                  <Button onClick={onClose}>Close</Button>
                  <Button variant="primary" onClick={() => setMode('edit')}>
                    {inheriting
                      ? `Customize for this ${TYPE_NAME[location.type]}`
                      : 'Edit statuses'}
                  </Button>
                </div>
              </div>
            </>
          )}
          {mode === 'edit' && (
            <StatusEditor
              workspaceId={workspaceId}
              locationId={location.id}
              current={statuses}
              inheriting={inheriting}
              onCancel={() => setMode('view')}
              onSaved={() => setMode('view')}
            />
          )}
          {mode === 'reset' && location.parentId && (
            <ResetPanel
              workspaceId={workspaceId}
              locationId={location.id}
              parentId={location.parentId}
              own={statuses}
              onCancel={() => setMode('view')}
              onDone={() => setMode('view')}
            />
          )}
        </div>
      )}
    </Dialog>
  )
}
