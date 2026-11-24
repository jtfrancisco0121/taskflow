import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import type { TaskView } from '../../api/types'
import { formatDay } from '../../shared/dates'
import { StatusPill } from '../../shared/ui/StatusPill'
import { useLocationStatuses } from '../statuses'
import { initialsOf, PRIORITY_LABEL } from './labels'

type TaskRowProps = {
  task: TaskView
  members: Map<string, string>
}

export function TaskRow({ task, members }: TaskRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const open = useMatch('/t/:taskId')?.params.taskId === task.id
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const status = statuses.data?.statuses?.find((s) => s.id === task.statusId)
  const assignees = task.assigneeIds ?? []
  const openTask = () => void navigate(`/t/${task.id}`, { state: { backgroundLocation: location } })

  return (
    <tr
      onClick={openTask}
      aria-current={open ? 'true' : undefined}
      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open ? 'bg-blue-50' : ''}`}
    >
      <td className="px-2 py-1.5 font-mono text-xs text-slate-500">{task.readableId}</td>
      <td className="px-2 py-1.5">
        <Link
          to={`/t/${task.id}`}
          state={{ backgroundLocation: location }}
          onClick={(event) => event.stopPropagation()}
          className="hover:underline focus:outline-2 focus:outline-blue-600"
        >
          {task.title}
        </Link>
      </td>
      <td className="px-2 py-1.5">
        {status ? <StatusPill name={status.name ?? ''} color={status.color} /> : null}
      </td>
      <td className="px-2 py-1.5 text-sm">{PRIORITY_LABEL[task.priority ?? 'NONE']}</td>
      <td className="px-2 py-1.5 text-sm">{formatDay(task.dueDate)}</td>
      <td className="px-2 py-1.5 text-sm">
        <span className="flex gap-1">
          {assignees.map((id) => {
            const name = members.get(id) ?? 'Former member'
            return (
              <span
                key={id}
                title={name}
                aria-label={name}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-medium"
              >
                {initialsOf(name)}
              </span>
            )
          })}
        </span>
      </td>
    </tr>
  )
}
