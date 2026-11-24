import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { FieldView, TaskView, ViewConfig, ViewQueryResponse } from '../../api/types'
import { formatDay } from '../../shared/dates'
import { ValueChip } from '../fields'
import { useLocationStatuses } from '../statuses'
import { PRIORITY_LABEL, initialsOf, useOptimisticTaskMutation } from '../tasks'
import { useMembers } from '../workspace'
import { insertItem, planDrop, removeItem, targetFields } from './boardPlan'
import { ColumnsPicker } from './ColumnsPicker'
import { DroppedNotice, NoMatches, hasFilter } from './ResultNotices'
import { groupLabel } from './groupLabels'
import { scopeId, type ViewScope } from './scope'
import { configHash, type Column as ConfigColumn, type UrlState } from './urlState'
import { customColumns, useScopeFields } from './useScopeFields'
import { useViewTasks } from './useViewTasks'

const PRIORITY_CLASS: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  NORMAL: 'bg-blue-100 text-blue-800',
  LOW: 'bg-slate-100 text-slate-700',
}

type Column = { key: string; label: string; count?: number }

/** BOARD-1/2: columns by status, priority or assignee, dnd-kit drops, optimistic with rollback. */
export function BoardRenderer({
  scope,
  config,
  update,
}: {
  scope: ViewScope
  config: ViewConfig
  update?: (patch: Partial<UrlState>) => void
}) {
  const queryClient = useQueryClient()
  const run = useOptimisticTaskMutation()
  const scopeFields = useScopeFields(scope)
  const chipFields = customColumns(config.columns, scopeFields.byId).map((c) => c.field)
  const boardConfig: ViewConfig = {
    ...config,
    group: config.group && config.group !== 'none' ? config.group : 'status',
  }
  const group = boardConfig.group!
  const lead = useViewTasks(scope, boardConfig, { limit: 1 })
  const statuses = useLocationStatuses(scope.workspaceId, scope.locationId)
  const { members } = useMembers(scope.workspaceId)
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const manual = (boardConfig.sort?.[0]?.key ?? 'manual') === 'manual'
  const hash = configHash(boardConfig)

  // Columns: the List's statuses first (so empty ones show), then groups only the server knows.
  const columns: Column[] = []
  const counts = new Map((lead.groups ?? []).map((g) => [g.key!, g]))
  if (group === 'status' && statuses.data?.statuses?.length) {
    for (const s of statuses.data.statuses) {
      const key = (s.name ?? '').trim().toLowerCase()
      if (!columns.some((c) => c.key === key)) {
        columns.push({ key, label: s.name ?? key, count: counts.get(key)?.count })
      }
    }
  }
  for (const g of lead.groups ?? []) {
    if (!columns.some((c) => c.key === g.key)) {
      columns.push({
        key: g.key!,
        label: groupLabel(group, g.key!, g.label, names),
        count: g.count,
      })
    }
  }
  if (group === 'assignee' && !columns.some((c) => c.key === 'none')) {
    columns.push({ key: 'none', label: 'Unassigned', count: 0 })
  }
  if (group === 'priority') {
    for (const p of ['URGENT', 'HIGH', 'NORMAL', 'LOW', 'NONE']) {
      if (!columns.some((c) => c.key === p)) {
        columns.push({ key: p, label: groupLabel('priority', p, undefined, names), count: 0 })
      }
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columnQueryKey = (key: string) =>
    queryKeys.view(scope.workspaceId, scopeId(scope), hash, key)
  const columnItems = (key: string): TaskView[] =>
    (
      queryClient.getQueryData<InfiniteData<ViewQueryResponse>>(columnQueryKey(key))?.pages ?? []
    ).flatMap((p) => (p.items ?? []).flatMap((i) => (i.task ? [i.task] : [])))

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const [from, taskId] = String(active.id).split('|')
    const overId = String(over.id)
    const to = overId.startsWith('col:') ? overId.slice(4) : overId.split('|')[0]
    const overTask = overId.startsWith('col:') ? null : overId.split('|')[1]
    drop(taskId, from, to, overTask)
  }

  function drop(taskId: string, from: string, to: string, overTask: string | null) {
    const card = columnItems(from).find((t) => t.id === taskId)
    if (!card) return
    const all: Record<string, TaskView[]> = { [from]: columnItems(from), [to]: columnItems(to) }
    const plan = planDrop(all, card, from, to, overTask, manual)
    if (from === to && plan.body.keepRank && !manual) return // nothing to say
    const label = columns.find((c) => c.key === to)?.label ?? to
    const fields = targetFields(group, to, from, label)
    const optimistic: Partial<TaskView> =
      group === 'priority'
        ? { priority: to as TaskView['priority'] }
        : group === 'assignee'
          ? {
              assigneeIds:
                to === 'none'
                  ? []
                  : [...new Set([...(card.assigneeIds ?? []).filter((id) => id !== from), to])],
            }
          : (() => {
              const status = statuses.data?.statuses?.find(
                (s) => (s.name ?? '').trim().toLowerCase() === to,
              )
              return status ? { statusId: status.id } : {}
            })()
    void run({
      task: card,
      optimistic,
      apply: (qc) => {
        const moved = { group: to, task: { ...card, ...optimistic } }
        qc.setQueryData<InfiniteData<ViewQueryResponse>>(columnQueryKey(from), (d) =>
          removeItem(d, taskId),
        )
        qc.setQueryData<InfiniteData<ViewQueryResponse>>(columnQueryKey(to), (d) =>
          insertItem(removeItem(d, taskId), plan.index, moved),
        )
      },
      send: (version) =>
        api.POST('/api/v1/tasks/{id}/move', {
          params: {
            path: { id: taskId },
            header: version != null ? { 'If-Match': `"${version}"` } : {},
          },
          body: { listId: card.listId!, ...fields, ...plan.body },
        }),
    })
  }

  const titleOf = (id: unknown) => {
    const [col, taskId] = String(id).split('|')
    const task = columnItems(col).find((t) => t.id === taskId)
    return task?.title ?? 'card'
  }
  const columnName = (id: unknown) => {
    const s = String(id)
    const key = s.startsWith('col:') ? s.slice(4) : s.split('|')[0]
    return columns.find((c) => c.key === key)?.label ?? key
  }

  return (
    <>
      <DroppedNotice dropped={lead.droppedFields} config={config} update={update} />
      {update && (
        <ColumnsPicker
          columns={(config.columns as ConfigColumn[] | undefined) ?? [{ field: 'title' }]}
          fields={scopeFields.fields}
          builtIn={false}
          onChange={(c) => update({ c })}
        />
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${titleOf(active.id)}. It is in ${columnName(active.id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
            onDragOver: ({ active, over }) =>
              over ? `${titleOf(active.id)} is over ${columnName(over.id)}.` : undefined,
            onDragEnd: ({ active, over }) =>
              over
                ? `${titleOf(active.id)} was dropped in ${columnName(over.id)}.`
                : `${titleOf(active.id)} was dropped.`,
            onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
          },
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Board">
          {columns.map((column) => (
            <BoardColumn
              key={column.key}
              column={column}
              scope={scope}
              config={boardConfig}
              names={names}
              chipFields={chipFields}
            />
          ))}
          {lead.isSuccess &&
            columns.length === 0 &&
            (hasFilter(config) ? (
              <NoMatches update={update} />
            ) : (
              <p className="text-slate-600">No tasks in this view.</p>
            ))}
        </div>
      </DndContext>
    </>
  )
}

function BoardColumn({
  column,
  scope,
  config,
  names,
  chipFields,
}: {
  column: Column
  scope: ViewScope
  config: ViewConfig
  names: Map<string, string>
  chipFields: FieldView[]
}) {
  const query = useViewTasks(scope, config, { groupValue: column.key })
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` })
  const tasks = query.items.flatMap((i) => (i.task ? [i.task] : []))
  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={`w-72 shrink-0 rounded bg-slate-100 p-2 ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      <h2 className="mb-2 flex justify-between px-1 text-sm font-semibold">
        <span>{column.label}</span>
        <span className="font-normal text-slate-500">{column.count ?? tasks.length}</span>
      </h2>
      <SortableContext
        items={tasks.map((t) => `${column.key}|${t.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex min-h-12 flex-col gap-2">
          {tasks.map((task) => (
            <Card
              key={task.id}
              id={`${column.key}|${task.id}`}
              task={task}
              names={names}
              chipFields={chipFields}
            />
          ))}
        </ul>
      </SortableContext>
      {query.hasNextPage && (
        <button
          type="button"
          className="mt-2 w-full rounded border border-slate-300 bg-white py-1 text-sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </button>
      )}
    </section>
  )
}

function Card({
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
  const priority = task.priority ?? 'NONE'
  // Up to three custom field chips of the view's columns; empty values are not drawn, "+N" for the rest.
  const values = (task.customFields ?? {}) as Record<string, unknown>
  const filled = chipFields.filter((f) => {
    const v = values[f.id!]
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  })
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded border border-slate-200 bg-white p-2 text-sm shadow-sm"
    >
      <Link
        to={`/t/${task.id}`}
        state={{ backgroundLocation: location }}
        className="font-medium hover:underline"
      >
        {task.title}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-mono">{task.readableId}</span>
        {priority !== 'NONE' && (
          <span className={`rounded px-1 ${PRIORITY_CLASS[priority]}`}>
            {PRIORITY_LABEL[priority]}
          </span>
        )}
        {task.dueDate && <span>{formatDay(task.dueDate)}</span>}
        {(task.assigneeIds ?? []).map((a) => (
          <span
            key={a}
            title={names.get(a) ?? 'Former member'}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200"
          >
            {initialsOf(names.get(a) ?? '?')}
          </span>
        ))}
      </div>
      {filled.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {filled.slice(0, 3).map((f) => (
            <ValueChip key={f.id} field={f} value={values[f.id!]} />
          ))}
          {filled.length > 3 && (
            <span className="text-xs text-slate-500">+{filled.length - 3}</span>
          )}
        </div>
      )}
    </li>
  )
}
