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
import { Button } from '../../shared/ui/Button'
import { addDays, calendarRange, dueDateFor, fromDay, shiftAnchor, todayUtc } from './calendarGrid'
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

/** CAL-1: month and week grids on UTC days; the range is a `dueDate between` condition. */
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
  const anchor = parseUrlState(params).state.d ?? todayUtc()
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
    const day = task.dueDate.slice(0, 10)
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
    if (!task || task.dueDate?.slice(0, 10) === day) return
    void actions.patch(task, { dueDate: dueDateFor(day) })
  }

  const title = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fromDay(anchor))

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Button aria-label="Previous" onClick={() => update({ d: shiftAnchor(mode, anchor, -1) })}>
          ‹
        </Button>
        <Button onClick={() => update({ d: todayUtc() })}>Today</Button>
        <Button aria-label="Next" onClick={() => update({ d: shiftAnchor(mode, anchor, 1) })}>
          ›
        </Button>
        <h2 className="mx-2 text-lg font-semibold">{title}</h2>
        <Button aria-pressed={mode === 'month'} onClick={() => update({ m: 'month', d: anchor })}>
          Month
        </Button>
        <Button aria-pressed={mode === 'week'} onClick={() => update({ m: 'week', d: anchor })}>
          Week
        </Button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div role="grid" aria-label="Calendar" className="grid grid-cols-7 gap-px bg-slate-200">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              role="columnheader"
              className="bg-slate-50 px-1 py-0.5 text-xs text-slate-500"
            >
              {d}
            </div>
          ))}
          {range.days.map((day) => (
            <DayCell
              key={day}
              day={day}
              dim={mode === 'month' && !day.startsWith(range.anchorMonth)}
              tasks={byDay.get(day) ?? []}
              expanded={openDay === day}
              onToggle={() => setOpenDay(openDay === day ? null : day)}
            />
          ))}
        </div>
      </DndContext>
      {undated != null && undated > 0 && (
        <p className="mt-2 text-sm text-slate-600">
          {undated} {undated === 1 ? 'task has' : 'tasks have'} no due date and{' '}
          {undated === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
      <span className="sr-only">{addDays(range.start, 0)}</span>
    </div>
  )
}

function DayCell({
  day,
  dim,
  tasks,
  expanded,
  onToggle,
}: {
  day: string
  dim: boolean
  tasks: TaskView[]
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
      className={`min-h-24 bg-white p-1 text-xs ${dim ? 'opacity-50' : ''} ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="mb-1 text-slate-500">{Number(day.slice(8))}</div>
      <ul className="flex flex-col gap-1">
        {shown.map((task) => (
          <Chip key={task.id} task={task} />
        ))}
      </ul>
      {tasks.length > VISIBLE_CHIPS && (
        <button type="button" className="mt-1 text-blue-700" onClick={onToggle}>
          {expanded ? 'Show less' : `+${tasks.length - VISIBLE_CHIPS} more`}
        </button>
      )}
    </div>
  )
}

function Chip({ task }: { task: TaskView }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id! })
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
      className="cursor-grab truncate rounded bg-blue-50 px-1 py-0.5"
    >
      <Link
        to={`/t/${task.id}`}
        state={{ backgroundLocation: location }}
        className="hover:underline"
      >
        {task.title}
      </Link>{' '}
      <BlockedBadge blocked={task.blocked} count={task.blockerCount} iconOnly />
    </li>
  )
}
