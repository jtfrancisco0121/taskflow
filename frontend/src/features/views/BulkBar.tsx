import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
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
import { useViewStore } from './viewStore'

const IN_FLIGHT = 6
const UNDO_MS = 10_000

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
  const [undo, setUndo] = useState<Array<{ id: string; version: number }> | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const chosen = tasks.filter((t) => selected.includes(t.id!))
  if (chosen.length === 0 && !undo) return null

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
    void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(scope.workspaceId) })
  }

  async function remove() {
    const deleted: Array<{ id: string; version: number }> = []
    const results = await runLimited(
      chosen,
      async (task) => {
        const { response } = await api.DELETE('/api/v1/tasks/{id}', {
          params: { path: { id: task.id! }, header: { 'If-Match': `"${task.version}"` } },
        })
        if (response.ok) deleted.push({ id: task.id!, version: (task.version ?? 0) + 1 })
        return response.ok ? ('saved' as const) : ('failed' as const)
      },
      IN_FLIGHT,
    )
    const failed = results.filter((r) => r.result !== 'saved')
    if (failed.length) {
      show(`Not deleted: ${failed.map((f) => f.item.readableId).join(', ')}`, 'error')
    }
    clear()
    void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(scope.workspaceId) })
    if (deleted.length) {
      setUndo(deleted)
      clearTimeout(undoTimer.current)
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
    }
  }

  async function restore() {
    const items = undo ?? []
    setUndo(null)
    clearTimeout(undoTimer.current)
    const results = await runLimited(
      items,
      async (item) => {
        const { response } = await api.POST('/api/v1/tasks/{id}/restore', {
          params: { path: { id: item.id }, header: { 'If-Match': `"${item.version}"` } },
        })
        return response.ok
      },
      IN_FLIGHT,
    )
    const bad = results.filter((r) => !r.result).length
    show(
      bad ? `${bad} tasks could not be restored.` : `Restored ${items.length} tasks.`,
      bad ? 'error' : 'info',
    )
    void queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll(scope.workspaceId) })
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="mb-2 flex flex-wrap items-center gap-2 rounded bg-blue-50 px-3 py-2 text-sm"
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
          <Button onClick={() => void remove()}>Delete</Button>
          <Button onClick={clear}>Clear</Button>
        </>
      )}
      {undo && (
        <span role="status">
          Deleted {undo.length} tasks.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void restore()}>
            Undo
          </button>
        </span>
      )}
    </div>
  )
}
