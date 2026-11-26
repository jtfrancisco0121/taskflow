import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { BlockedBadge } from '../dependencies'
import { useViewParams } from './viewParams'
import type { TaskView, ViewConfig, ViewFilter } from '../../api/types'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { IconButton } from '../../shared/ui/IconButton'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useLocationStatuses } from '../statuses'
import { PriorityValue } from '../tasks'
import {
  calendarRange,
  dayOfDue,
  dueDateFor,
  fromDay,
  shiftAnchor,
  todayLocal,
} from './calendarGrid'
import type { ViewScope } from './scope'
import { parseUrlState, type UrlState } from './urlState'
import { useTaskActions } from './useTaskActions'
import { useViewTasks } from './useViewTasks'

/** Keyboard dragging jumps by day cells: Left/Right one day, Up/Down one week. */
const dayCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const step = (
    { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 } as Record<string, number>
  )[event.code]
  const { droppableRects, droppableContainers, collisionRect } = context
  if (!step || !collisionRect) return undefined
  event.preventDefault()
  const days = [...droppableContainers.getEnabled()]
    .filter((c) => String(c.id).startsWith('day:'))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const cx = collisionRect.left + collisionRect.width / 2
  const cy = collisionRect.top + collisionRect.height / 2
  const here = days.findIndex((c) => {
    const r = droppableRects.get(c.id)
    return !!r && cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height
  })
  const target = days[Math.min(days.length - 1, Math.max(0, (here < 0 ? 0 : here) + step))]
  const rect = target && droppableRects.get(target.id)
  return rect ? { x: rect.left + 4, y: rect.top + 4 } : undefined
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const VISIBLE_CHIPS = 3

/** CAL-1 (revised, slice 8): month and week grids on the viewer's local days; the range is a `dueDate between` condition. */
export function CalendarRenderer({
  scope,
  config,
  update,
}: {
  scope: ViewScope
  config: ViewConfig
  update: (patch: Partial<UrlState>) => void
}) {
  const [params] = useViewParams()
  const mode = config.mode === 'week' ? 'week' : 'month'
  const anchor = parseUrlState(params).state.d ?? todayLocal()
  const range = calendarRange(mode, anchor)
  const actions = useTaskActions()
  const [openDay, setOpenDay] = useState<string | null>(null)

  const between: ViewFilter = {
    field: 'dueDate',
    op: 'between',
    value: [range.start, range.end] as unknown as ViewFilter['value'],
  }
  const filter: ViewFilter = config.filter
    ? { op: 'AND', items: [config.filter, between] }
    : { op: 'AND', items: [between] }
  const visible: ViewConfig = {
    ...config,
    group: 'none',
    filter,
    sort: [{ key: 'dueDate', dir: 'asc' }],
  }
  const query = useViewTasks(scope, visible, { limit: 200 })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  // Tasks without a due date are not shown: say how many are hidden.
  const undated = useViewTasks(
    scope,
    { ...config, group: 'dueDate', sort: undefined },
    { limit: 1 },
  ).groups?.find((g) => g.key === 'none')?.count

  const byDay = new Map<string, TaskView[]>()
  for (const item of query.items) {
    const task = item.task
    if (!task?.dueDate) continue
    const day = dayOfDue(task.dueDate)
    byDay.set(day, [...(byDay.get(day) ?? []), task])
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: dayCoordinates }),
  )
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    const day = String(over.id).replace('day:', '')
    const task = query.items.find((i) => i.task?.id === String(active.id))?.task
    if (!task || (task.dueDate ? dayOfDue(task.dueDate) : '') === day) return
    void actions.patch(task, { dueDate: dueDateFor(day) })
  }

  const title = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
  }).format(fromDay(anchor))

  const statuses = useLocationStatuses(scope.workspaceId, scope.locationId).data?.statuses
  const statusOf = (id: string | undefined) => statuses?.find((s) => s.id === id)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <IconButton label="Previous" onClick={() => update({ d: shiftAnchor(mode, anchor, -1) })}>
          <Chevron d="M10 3l-5 5 5 5" />
        </IconButton>
        <Button onClick={() => update({ d: todayLocal() })}>Today</Button>
        <IconButton label="Next" onClick={() => update({ d: shiftAnchor(mode, anchor, 1) })}>
          <Chevron d="M6 3l5 5-5 5" />
        </IconButton>
        <h2 className="mx-2 font-display text-lg font-semibold text-fg">{title}</h2>
        <div className="ml-auto flex gap-1">
          {(['month', 'week'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'secondary'}
              aria-pressed={mode === m}
              onClick={() => update({ m, d: anchor })}
            >
              {m === 'month' ? 'Month' : 'Week'}
            </Button>
          ))}
        </div>
      </div>
      {query.isError ? (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div
              role="grid"
              aria-label="Calendar"
              className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line"
            >
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  role="columnheader"
                  className="bg-surface-2 px-2 py-1 text-xs font-medium text-muted"
                >
                  {d}
                </div>
              ))}
              {range.days.map((day) => (
                <DayCell
                  key={day}
                  day={day}
                  dim={mode === 'month' && !day.startsWith(range.anchorMonth)}
                  today={day === todayLocal()}
                  tasks={byDay.get(day) ?? []}
                  statusOf={statusOf}
                  expanded={openDay === day}
                  onToggle={() => setOpenDay(openDay === day ? null : day)}
                />
              ))}
            </div>
          </DndContext>
          {query.isPending && (
            <div
              role="status"
              aria-label="Loading the Calendar"
              className="mt-2 flex flex-col gap-1"
            >
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          )}
          {query.isSuccess && query.items.length === 0 && (
            <EmptyState title="No tasks due in this range." />
          )}
        </>
      )}
      {undated != null && undated > 0 && (
        <p className="mt-2 text-[13px] text-muted">
          {undated} {undated === 1 ? 'task has' : 'tasks have'} no due date and{' '}
          {undated === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
    </div>
  )
}

const Chevron = ({ d }: { d: string }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
)

type StatusLookup = (id: string | undefined) => { name?: string; color?: string | null } | undefined

function DayCell({
  day,
  dim,
  today,
  tasks,
  statusOf,
  expanded,
  onToggle,
}: {
  day: string
  dim: boolean
  today: boolean
  tasks: TaskView[]
  statusOf: StatusLookup
  expanded: boolean
  onToggle: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` })
  const shown = expanded ? tasks : tasks.slice(0, VISIBLE_CHIPS)
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={day}
      data-day={day}
      // Days outside the month sit on a quieter ground, not at half opacity: opacity cannot meet 4.5:1 (slice 2).
      className={`min-h-24 p-1 text-xs ${dim ? 'bg-surface-2' : 'bg-surface'} ${isOver ? 'ring-2 ring-inset ring-accent-line' : ''}`}
    >
      <div className="mb-1 text-muted">
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${today ? 'bg-accent font-semibold text-accent-fg' : ''}`}
          aria-current={today ? 'date' : undefined}
        >
          {Number(day.slice(8))}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((task) => (
          <Chip key={task.id} task={task} status={statusOf(task.statusId)} />
        ))}
      </ul>
      {tasks.length > VISIBLE_CHIPS && (
        <button
          type="button"
          className="mt-1 rounded text-accent hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
          onClick={onToggle}
        >
          {expanded ? 'Show less' : `+${tasks.length - VISIBLE_CHIPS} more`}
        </button>
      )}
    </div>
  )
}

function Chip({ task, status }: { task: TaskView; status?: ReturnType<StatusLookup> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id!,
  })
  const location = useLocation()
  return (
    <li
      ref={setNodeRef}
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      className={`flex cursor-grab items-center gap-1 rounded border bg-surface-2 px-1 py-0.5 ${isDragging ? 'z-10 border-accent-line shadow-float' : 'border-line hover:border-line-strong'} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring`}
    >
      <span
        role="img"
        aria-label={status?.name ?? 'Status'}
        className={`h-2 w-2 shrink-0 rounded-full ${status?.color ? '' : 'bg-status-todo'}`}
        style={status?.color ? { backgroundColor: status.color } : undefined}
      />
      <Link
        to={`/t/${task.id}`}
        state={{ backgroundLocation: location }}
        // The link is its own tab stop: Enter opens the task and Space is the link's own; the chip's drag sensor must not take them. Other keys bubble (? and / shortcuts).
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
        }}
        className="min-w-0 flex-1 truncate rounded-sm text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
      >
        {task.title}
      </Link>
      {task.priority && task.priority !== 'NONE' && <PriorityValue priority={task.priority} />}
      <BlockedBadge blocked={task.blocked} count={task.blockerCount} iconOnly />
    </li>
  )
}
