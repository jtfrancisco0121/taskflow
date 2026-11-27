import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { Button } from '../../shared/ui/Button'
import { Select } from '../../shared/ui/Select'
import { useLocationStatuses } from '../statuses'
import { PRIORITIES, PRIORITY_LABEL } from '../tasks'
import { runLimited } from './bulk'
import type { ViewScope } from './scope'
import { useTaskActions } from './useTaskActions'
import { useTrashTasks } from './useTrashTasks'
import { useViewStore } from './viewStore'

const IN_FLIGHT = 6

type Member = { userId?: string; displayName?: string; email?: string }

const REASON = { conflict: 'changed by someone else', failed: 'could not be saved' } as const

/** LIST-1 Bulk actions: status, priority, assignees and delete with a 10 s Undo (AD-10). */
export function BulkBar({
  scope,
  tasks,
  members,
}: {
  scope: ViewScope
  tasks: TaskView[]
  members: Member[]
}) {
  const queryClient = useQueryClient()
  const selected = useViewStore((s) => s.selected)
  const clear = useViewStore((s) => s.clearSelection)
  const show = useToastStore((s) => s.show)
  const actions = useTaskActions()
  const statuses = useLocationStatuses(scope.workspaceId, scope.locationId)
  const [assignee, setAssignee] = useState('')
  const trashTasks = useTrashTasks(scope)

  const chosen = tasks.filter((t) => selected.includes(t.id!))
  if (chosen.length === 0) return null

  async function fanOut(
    label: string,
    worker: (task: TaskView) => Promise<'saved' | 'conflict' | 'failed'>,
  ) {
    const results = await runLimited(chosen, worker, IN_FLIGHT)
    const failed = results.filter((r) => r.result !== 'saved')
    if (failed.length === 0) show(`${label}: ${results.length} updated.`)
    else {
      show(
        `${label}: ${results.length - failed.length} of ${results.length} updated. Not updated: ${failed
          .map((f) => `${f.item.readableId} (${REASON[f.result as 'conflict' | 'failed']})`)
          .join(', ')}`,
        'error',
      )
    }
    clear()
    // Each item's write already restarts the views still on their first load (also after a lost response or a
    // 5xx), so this only re-reads loaded views (sort, filters). A cancel here would kill those restarts.
    // eslint-disable-next-line no-restricted-syntax -- first-load safe: every item restarted its first loads
    void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(scope.workspaceId) })
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="glass sticky top-2 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-fg"
    >
      {chosen.length > 0 && (
        <>
          <span>{chosen.length} selected</span>
          <Select
            aria-label="Set priority"
            value=""
            onValueChange={(next) =>
              next &&
              void fanOut('Priority', (t) =>
                actions.patch(t, { priority: next as TaskView['priority'] }, true),
              )
            }
            options={PRIORITIES.map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p] === '—' ? 'None' : PRIORITY_LABEL[p],
            }))}
            placeholder="Set priority…"
          />
          {scope.locationId && (
            <Select
              aria-label="Set status"
              value=""
              onValueChange={(next) =>
                next && void fanOut('Status', (t) => actions.setStatusByName(t, next, true))
              }
              options={(statuses.data?.statuses ?? []).map((s) => ({
                value: s.name ?? '',
                label: s.name ?? '',
              }))}
              placeholder="Set status…"
            />
          )}
          <Select
            aria-label="Assignee"
            value={assignee}
            onValueChange={setAssignee}
            options={members.map((m) => ({
              value: m.userId ?? '',
              label: m.displayName ?? m.email ?? '',
            }))}
            placeholder="Assignee…"
          />
          <Button
            disabled={!assignee}
            onClick={() =>
              void fanOut('Assign', (t) =>
                actions.patch(
                  t,
                  { assigneeIds: [...new Set([...(t.assigneeIds ?? []), assignee])] },
                  true,
                ),
              )
            }
          >
            Assign
          </Button>
          <Button
            disabled={!assignee}
            onClick={() =>
              void fanOut('Unassign', (t) =>
                actions.patch(
                  t,
                  { assigneeIds: (t.assigneeIds ?? []).filter((id) => id !== assignee) },
                  true,
                ),
              )
            }
          >
            Unassign
          </Button>
          <Button
            disabled={trashTasks.pending}
            onClick={() => void trashTasks.trash(chosen, tasks)}
          >
            Delete
          </Button>
          <Button onClick={clear}>Clear</Button>
        </>
      )}
    </div>
  )
}
