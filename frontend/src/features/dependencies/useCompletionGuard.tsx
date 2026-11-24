import { useCallback, useState } from 'react'
import type { TaskView } from '../../api/types'
import { CompleteAnywayDialog, type Ask } from './CompleteAnywayDialog'

/**
 * The complete-anyway guard (FR-6, AD-7): every status path of a single task awaits `confirm`
 * before it writes. It resolves at once unless the task is blocked and the change completes it;
 * otherwise it asks, resolving on "Complete anyway" and rejecting on Cancel or Escape (nothing is
 * sent). Render `dialog` once next to the caller. Never a hard block: the API accepts the change.
 */
export function useCompletionGuard() {
  const [ask, setAsk] = useState<Ask | null>(null)

  const confirm = useCallback(
    (
      task: Pick<TaskView, 'id' | 'title' | 'blocked' | 'blockerCount'>,
      completes: boolean,
    ): Promise<void> => {
      if (!task.blocked || !completes) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        setAsk({ task, resolve, reject })
      })
    },
    [],
  )

  const settle = (done: boolean) => {
    if (!ask) return
    setAsk(null)
    if (done) ask.resolve()
    else ask.reject(new Error('cancelled'))
  }

  const dialog = ask ? (
    <CompleteAnywayDialog
      task={ask.task}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null
  return { confirm, dialog }
}
