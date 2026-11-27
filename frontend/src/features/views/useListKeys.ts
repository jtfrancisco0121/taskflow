import type { Virtualizer } from '@tanstack/react-virtual'
import { useRef, type KeyboardEvent } from 'react'
import type { TaskView } from '../../api/types'
import { MODAL_DIALOG } from '../../shared/ui/floating'
import { isShortcutBlocked } from '../../shared/ui/shortcutGuard'
import { isTrashPending, useTrashTasks } from './useTrashTasks'
import type { ViewScope } from './scope'
import { useViewStore, type EditorField } from './viewStore'

const EDITOR_KEYS: Record<string, EditorField> = {
  s: 'status',
  p: 'priority',
  a: 'assignee',
  d: 'due',
}

type KeyRow = { rowIndex: number; task: TaskView }

/**
 * Focuses the row of a task once the virtualizer has rendered it (it may have to scroll there first). A modal
 * dialog that took focus meanwhile (the command palette opened by Ctrl/Cmd+K in that frame) keeps it (AD-5).
 */
function focusRow(id: string, done: () => void, attempts = 6) {
  requestAnimationFrame(() => {
    if (document.activeElement?.closest(MODAL_DIALOG)) {
      done()
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
    if (el) {
      el.focus()
      done()
    } else if (attempts > 0) focusRow(id, done, attempts - 1)
    else done()
  })
}

/**
 * AD-3: the List's row keys, attached as `onKeyDown` to the Tasks table. j/k and the arrows move between task
 * rows (group rows are skipped), x selects, Enter opens the task (only when the row itself has focus), s/p/a/d
 * open that row's editor, Backspace/Delete trash the selection or the focused row, Escape clears the selection.
 * Every key first asks `isShortcutBlocked`: nothing happens (and nothing is prevented) in a text field, under a
 * modal dialog or a floating layer, or with Ctrl/Cmd/Alt held.
 */
export function useListKeys({
  scope,
  taskRows,
  loaded,
  virtualizer,
  openTask,
}: {
  scope: ViewScope
  /** The task rows in display order, with their index among all rows (group headers included). */
  taskRows: KeyRow[]
  /** Every task the view has loaded (parents of a selected subtask may be there). */
  loaded: TaskView[]
  virtualizer: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex'>
  openTask: (id: string) => void
}) {
  const trashTasks = useTrashTasks(scope)
  // The row a move is heading for: focus lands a frame later, and a key pressed meanwhile continues from here.
  const heading = useRef<string | null>(null)

  function moveTo(id: string) {
    const target = taskRows.find((r) => r.task.id === id)
    if (!target) return
    heading.current = id
    virtualizer.scrollToIndex(target.rowIndex)
    focusRow(id, () => {
      if (heading.current === id) heading.current = null
    })
  }

  return function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isShortcutBlocked(event.nativeEvent)) return
    const store = useViewStore.getState()
    const rowEl = (event.target as Element).closest<HTMLElement>('[data-task-id]')
    const focusedId = heading.current ?? rowEl?.dataset.taskId ?? store.focusedTaskId
    const index = taskRows.findIndex((r) => r.task.id === focusedId)
    const key = event.key

    if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
      if (taskRows.length === 0) return
      const down = key === 'j' || key === 'ArrowDown'
      const next =
        index < 0 ? 0 : Math.min(taskRows.length - 1, Math.max(0, index + (down ? 1 : -1)))
      event.preventDefault()
      moveTo(taskRows[next].task.id!)
      return
    }
    if (key === 'Escape') {
      if (store.selected.length === 0) return
      event.preventDefault()
      store.clearSelection()
      return
    }
    if (index < 0) return
    const task = taskRows[index].task
    if (key === 'x') {
      event.preventDefault()
      store.toggleSelected(task.id!)
    } else if (key === 'Enter') {
      // Enter on a button or link inside the row belongs to that control.
      if (event.target !== rowEl) return
      event.preventDefault()
      openTask(task.id!)
    } else if (EDITOR_KEYS[key]) {
      event.preventDefault()
      store.setOpenEditor({ taskId: task.id!, field: EDITOR_KEYS[key] })
    } else if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      // A held key repeats, and a second press while one is in flight would start a second batch.
      if (event.repeat || isTrashPending()) return
      const inSelection = store.selected.includes(task.id!)
      const targets = inSelection ? loaded.filter((t) => store.selected.includes(t.id!)) : [task]
      const gone = new Set(targets.map((t) => t.id))
      const neighbour =
        taskRows.slice(index + 1).find((r) => !gone.has(r.task.id)) ??
        taskRows
          .slice(0, index)
          .reverse()
          .find((r) => !gone.has(r.task.id))
      void trashTasks.trash(targets, loaded)
      if (neighbour) moveTo(neighbour.task.id!)
    }
  }
}
