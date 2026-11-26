import type { TaskView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { useDependencies } from './useDependencies'

export type Ask = {
  task: Pick<TaskView, 'id' | 'title' | 'blockerCount'>
  resolve: () => void
  reject: (reason: Error) => void
}

export function CompleteAnywayDialog({
  task,
  onConfirm,
  onCancel,
}: {
  task: Ask['task']
  onConfirm: () => void
  onCancel: () => void
}) {
  const deps = useDependencies(task.id)
  const open = (deps.data?.waitingOn ?? []).filter((i) => !i.task?.finished).slice(0, 3)
  const count = Math.max(task.blockerCount ?? open.length, 1)
  const sentence = `${task.title} is waiting on ${count} unfinished ${count === 1 ? 'task' : 'tasks'}`
  return (
    <Dialog title={sentence} onClose={onCancel}>
      {open.length > 0 && (
        <ul className="mb-3 list-none p-0 text-sm text-fg">
          {open.map((i) => (
            <li key={i.dependencyId}>
              <span className="font-mono text-xs">{i.task?.readableId}</span> {i.task?.title}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-row-reverse justify-start gap-2">
        <Button variant="primary" onClick={onConfirm}>
          Complete anyway
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}
