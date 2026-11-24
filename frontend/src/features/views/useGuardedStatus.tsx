import type { StatusInfo, TaskView } from '../../api/types'
import { completesTask, useCompletionGuard } from '../dependencies'
import { useTaskActions } from './useTaskActions'

/**
 * The inline status cell's write (List and Table): a change that completes a blocked task asks
 * first (FR-6); Cancel sends nothing and the cell shows the old status again. `dialog` is the
 * warning, rendered once next to the cell.
 */
export function useGuardedStatus() {
  const actions = useTaskActions()
  const guard = useCompletionGuard()
  async function change(task: TaskView, statusId: string, statuses: StatusInfo[]) {
    const group = (id: string | undefined) => statuses.find((s) => s.id === id)?.group
    try {
      await guard.confirm(task, completesTask(group(task.statusId), group(statusId)))
    } catch {
      return
    }
    await actions.patch(task, { statusId })
  }
  return { change, dialog: guard.dialog }
}
