import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { cancelThenInvalidate, inBackground } from '../../api/refresh'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { runLimited } from './bulk'
import type { ViewScope } from './scope'
import { useViewStore } from './viewStore'

const IN_FLIGHT = 6
const UNDO_MS = 10_000

type Trashed = { id: string; version: number; parentTaskId?: string | null }

/** The one open undo window: every trash inside it joins the same toast and the same Undo (AD-4). */
const undoWindow: { toastId: number | null; items: Trashed[]; count: number } = {
  toastId: null,
  items: [],
  count: 0,
}
let trashing = 0

const tasksText = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

/** True while a trash is in flight (any caller): a held Backspace must not start a second batch. */
export const isTrashPending = () => trashing > 0

/** Restores level by level, ancestors before descendants; a descendant already back with its parent counts. */
async function restoreAll(items: Trashed[]): Promise<number> {
  const ids = new Set(items.map((i) => i.id))
  const parentOf = new Map(items.map((i) => [i.id, i.parentTaskId ?? null]))
  const depth = (id: string): number => {
    let d = 0
    for (let p = parentOf.get(id); p && ids.has(p); p = parentOf.get(p)) d += 1
    return d
  }
  const levels = new Map<number, Trashed[]>()
  for (const item of items)
    levels.set(depth(item.id), [...(levels.get(depth(item.id)) ?? []), item])
  let failed = 0
  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    const results = await runLimited(
      levels.get(level) ?? [],
      async (item) => {
        const { response } = await api.POST('/api/v1/tasks/{id}/restore', {
          params: { path: { id: item.id }, header: { 'If-Match': `"${item.version}"` } },
        })
        // A descendant that is no longer in the trash came back with its parent's batch.
        return response.ok || (level > 0 && response.status === 404)
      },
      IN_FLIGHT,
    )
    failed += results.filter((r) => !r.result).length
  }
  return failed
}

function refresh(queryClient: QueryClient, workspaceId: string) {
  // A trashed or restored task leaves or joins a parent's subtasks; a first load in flight is restarted.
  // Started, not awaited: the Undo toast does not wait for a refetch.
  inBackground(
    cancelThenInvalidate(
      queryClient,
      { queryKey: queryKeys.viewsAll(workspaceId) },
      { queryKey: queryKeys.subtaskScanAll() },
    ),
  )
}

/**
 * AD-4: the only trash and restore path of the views feature. Bulk Delete and the Backspace key both end here, so
 * versions, the six-in-flight limit and the undo window cannot drift apart.
 */
export function useTrashTasks(scope: ViewScope) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  async function undo() {
    const items = undoWindow.items
    const count = undoWindow.count
    undoWindow.toastId = null
    undoWindow.items = []
    undoWindow.count = 0
    const failed = await restoreAll(items)
    const show = useToastStore.getState().show
    if (failed) show(`${tasksText(failed)} could not be restored.`, 'error')
    else show(`Restored ${tasksText(count)}.`)
    refresh(queryClient, scope.workspaceId)
  }

  /**
   * Trashes `selected`. `loaded` is every task the view shows, so a task whose ancestor is selected too is not sent:
   * the parent's trash cascades into it.
   */
  async function trash(selected: TaskView[], loaded: TaskView[] = selected) {
    if (selected.length === 0) return
    const byId = new Map(loaded.map((t) => [t.id!, t]))
    const chosen = new Set(selected.map((t) => t.id!))
    const hasSelectedAncestor = (task: TaskView) => {
      for (let p = task.parentTaskId; p; p = byId.get(p)?.parentTaskId)
        if (chosen.has(p)) return true
      return false
    }
    const toSend = selected.filter((t) => !hasSelectedAncestor(t))
    const show = useToastStore.getState().show
    trashing += 1
    setPending(true)
    try {
      const done: Trashed[] = []
      const results = await runLimited(
        toSend,
        async (task) => {
          const { response } = await api.DELETE('/api/v1/tasks/{id}', {
            params: { path: { id: task.id! }, header: { 'If-Match': `"${task.version}"` } },
          })
          if (response.ok) {
            done.push({
              id: task.id!,
              version: (task.version ?? 0) + 1,
              parentTaskId: task.parentTaskId,
            })
          }
          return response.ok
        },
        IN_FLIGHT,
      )
      const failed = results.filter((r) => !r.result)
      if (failed.length) {
        show(`Not deleted: ${failed.map((f) => f.item.readableId).join(', ')}`, 'error')
      }
      useViewStore.getState().clearSelection()
      refresh(queryClient, scope.workspaceId)
      if (done.length === 0) return
      // Tasks that rode along with a trashed parent count as moved.
      const moved = selected.length - failed.length
      const store = useToastStore.getState()
      const open = store.toasts.some((t) => t.id === undoWindow.toastId)
      if (open && undoWindow.toastId !== null) {
        undoWindow.items = [...undoWindow.items, ...done]
        undoWindow.count += moved
        store.update(undoWindow.toastId, {
          message: `Moved ${tasksText(undoWindow.count)} to trash.`,
        })
      } else {
        undoWindow.items = done
        undoWindow.count = moved
        undoWindow.toastId = store.show(`Moved ${tasksText(moved)} to trash.`, 'info', {
          action: { label: 'Undo', onAction: undo },
          durationMs: UNDO_MS,
        })
      }
    } finally {
      trashing -= 1
      setPending(trashing > 0)
    }
  }

  return { trash, pending }
}
