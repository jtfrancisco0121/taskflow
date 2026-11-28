import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ApiError, messageOf } from '../../api/errors'
import type { StatusInfo, TaskView } from '../../api/types'
import { StatusValue } from './editorItems'
import { useCreateTask } from './useCreateTask'
import { useSubtasks } from './useSubtasks'
import { useTask } from './useTask'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

const finished = (group: string | undefined) => group === 'DONE' || group === 'CLOSED'

/** "Subtask of <id> <title>" above a subtask's fields; a parent the person cannot see says so. */
export function ParentLink({ task }: { task: TaskView }) {
  const location = useLocation()
  const parent = useTask(task.parentTaskId)
  if (!task.parentTaskId) return null
  const hidden =
    parent.error instanceof ApiError && (parent.error.status === 403 || parent.error.status === 404)
  if (hidden) return <p className="text-sm text-muted">Subtask of a task you can’t see</p>
  if (!parent.data) return null
  return (
    <p className="text-sm text-muted">
      Subtask of{' '}
      <Link
        to={`/t/${parent.data.id}`}
        replace
        state={location.state}
        className="text-accent hover:underline"
      >
        {parent.data.readableId} {parent.data.title}
      </Link>
    </p>
  )
}

/** CAP-7: the task's subtasks with their status, and a field that adds one in the same List. */
export function SubtasksSection({ task, statuses }: { task: TaskView; statuses: StatusInfo[] }) {
  const location = useLocation()
  const subtasks = useSubtasks(task)
  const create = useCreateTask(task.workspaceId!, task.listId!)
  const [title, setTitle] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const busy = useRef(false)
  const items = [...(subtasks.data?.items ?? [])].sort((a, b) => {
    const group = (t: TaskView) => statuses.find((s) => s.id === t.statusId)?.group
    return Number(finished(group(a))) - Number(finished(group(b)))
  })

  async function add() {
    const value = title.trim()
    if (!value || busy.current) return
    busy.current = true
    setRefusal(null)
    try {
      await create.mutateAsync({ title: value, parentTaskId: task.id })
      setTitle('')
    } catch (error) {
      setRefusal(messageOf(error))
    } finally {
      busy.current = false
    }
  }

  return (
    <section aria-label="Subtasks" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase text-muted">Subtasks</h3>
      {subtasks.isPending && (
        <div aria-busy="true" className="h-4 animate-pulse rounded bg-surface-3" />
      )}
      {refreshFailed(subtasks) && (
        <RefreshNotice
          message={messageOf(subtasks.error)}
          onRetry={() => void subtasks.refetch()}
        />
      )}
      {loadFailed(subtasks) && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load the subtasks: {messageOf(subtasks.error)}{' '}
          <button type="button" className="underline" onClick={() => void subtasks.refetch()}>
            Retry
          </button>
        </p>
      )}
      {hasData(subtasks) && items.length === 0 && (
        <p className="text-sm text-muted">No subtasks yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((child) => (
          <li key={child.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted">{child.readableId}</span>
            <Link
              to={`/t/${child.id}`}
              replace
              state={location.state}
              className="min-w-0 flex-1 truncate text-fg hover:underline"
            >
              {child.title}
            </Link>
            <StatusValue status={statuses.find((s) => s.id === child.statusId)} />
          </li>
        ))}
      </ul>
      {subtasks.data?.capped && (
        <p className="text-xs text-muted">
          Showing subtasks among the first 2,000 tasks of this List.
        </p>
      )}
      <input
        aria-label="Add a subtask"
        placeholder="Add a subtask"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void add()
          } else if (event.key === 'Escape' && title !== '') {
            event.stopPropagation()
            setTitle('')
          }
        }}
        className="h-8 rounded-md border border-dashed border-line-strong bg-surface px-2 text-sm text-fg placeholder:text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
      />
      {refusal && (
        <p role="alert" className="text-xs text-danger">
          {refusal}
        </p>
      )}
    </section>
  )
}
