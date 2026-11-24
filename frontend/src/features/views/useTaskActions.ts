import { api } from '../../api/client'
import type { components } from '../../api/schema'
import type { TaskView } from '../../api/types'
import { useOptimisticTaskMutation, type TaskOutcome } from '../tasks'

export type TaskPatch = components['schemas']['UpdateTaskRequest']

const ifMatch = (version: number | undefined) =>
  version != null ? { 'If-Match': `"${version}"` } : {}

/** Edits through the one optimistic helper (AD-20): inline cells, Table editors and Bulk items. */
export function useTaskActions() {
  const run = useOptimisticTaskMutation()
  return {
    patch(task: TaskView, patch: TaskPatch, silent = false): Promise<TaskOutcome> {
      return run({
        task,
        silent,
        optimistic: patch as Partial<TaskView>,
        send: (version) =>
          api.PATCH('/api/v1/tasks/{id}', {
            params: { path: { id: task.id! }, header: ifMatch(version) },
            body: patch,
          }),
      })
    },
    /** A status change by name (resolved against the task's own List, so mixed Lists work). */
    setStatusByName(task: TaskView, statusName: string, silent = false): Promise<TaskOutcome> {
      return run({
        task,
        silent,
        send: (version) =>
          api.POST('/api/v1/tasks/{id}/move', {
            params: { path: { id: task.id! }, header: ifMatch(version) },
            body: { listId: task.listId!, statusName, keepRank: true },
          }),
      })
    },
  }
}
