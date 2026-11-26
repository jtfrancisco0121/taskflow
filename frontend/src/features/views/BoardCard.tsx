import { useSortable } from '@dnd-kit/sortable'
import { Link, useLocation } from 'react-router'
import type { FieldView, TaskView } from '../../api/types'
import { BlockedBadge } from '../dependencies'
import { ValueChip } from '../fields'
import { AssigneesValue, DayValue, PriorityValue } from '../tasks'

/** One Board card. The `<li>` is the focusable, draggable element and carries `data-task-id` (focus return). */
export function BoardCard({
  id,
  task,
  names,
  chipFields,
}: {
  id: string
  task: TaskView
  names: Map<string, string>
  chipFields: FieldView[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const location = useLocation()
  const style = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? undefined
      : transition,
    opacity: isDragging ? 0.5 : 1,
  }
  // Up to three custom field chips of the view's columns; empty values are not drawn, "+N" for the rest.
  const values = (task.customFields ?? {}) as Record<string, unknown>
  const filled = chipFields.filter((f) => {
    const v = values[f.id!]
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  })
  const assignees = task.assigneeIds ?? []
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-md border border-line bg-surface p-2 text-sm outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <Link
        to={`/t/${task.id}`}
        state={{ backgroundLocation: location }}
        className="line-clamp-3 font-medium text-fg hover:underline"
      >
        {task.title}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono text-faint">{task.readableId}</span>
        <BlockedBadge blocked={task.blocked} count={task.blockerCount} />
        {task.priority && task.priority !== 'NONE' && <PriorityValue priority={task.priority} />}
        {task.dueDate && <DayValue iso={task.dueDate} />}
        {assignees.length > 0 && <AssigneesValue ids={assignees} names={names} />}
      </div>
      {filled.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {filled.slice(0, 3).map((f) => (
            <ValueChip key={f.id} field={f} value={values[f.id!]} />
          ))}
          {filled.length > 3 && <span className="text-xs text-faint">+{filled.length - 3}</span>}
        </div>
      )}
    </li>
  )
}
