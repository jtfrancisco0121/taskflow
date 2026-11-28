import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '../../api/client'
import { messageOf } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewConfig, ViewQueryResponse } from '../../api/types'
import { Avatar } from '../../shared/ui/Avatar'
import { Skeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { completesTask, useCompletionGuard } from '../dependencies'
import { useLocationStatuses } from '../statuses'
import { PriorityValue, StatusValue, useOptimisticTaskMutation } from '../tasks'
import type { Priority } from '../../api/types'
import { useMembers } from '../workspace'
import { insertItem, moveCount, planDrop, removeItem, targetFields } from './boardPlan'
import { BoardColumn, type Column } from './BoardColumn'
import { ColumnsPicker } from './ColumnsPicker'
import { DroppedNotice, NoMatches, hasFilter } from './ResultNotices'
import { groupLabel } from './groupLabels'
import { scopeId, type ViewScope } from './scope'
import { configHash, type Column as ConfigColumn, type UrlState } from './urlState'
import { customColumns, useScopeFields } from './useScopeFields'
import { useViewTasks } from './useViewTasks'

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
  const guard = useCompletionGuard()
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
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space lifts and drops; Enter is left to the card (it opens the task detail).
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  const columnQueryKey = (key: string) =>
    queryKeys.view(scope.workspaceId, scopeId(scope), hash, key)
  const leadQueryKey = queryKeys.view(scope.workspaceId, scopeId(scope), hash, undefined, 1)
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
    // A drop that completes a blocked card asks first; Cancel changes nothing, so the card stays.
    const groupOf = (name: string) =>
      statuses.data?.statuses?.find((s) => (s.name ?? '').trim().toLowerCase() === name)?.group
    const completes = group === 'status' && from !== to && completesTask(groupOf(from), groupOf(to))
    if (completes && card.blocked) {
      guard.confirm(card, true).then(
        () => performDrop(card, taskId, from, to, overTask),
        () => undefined,
      )
      return
    }
    performDrop(card, taskId, from, to, overTask)
  }

  function performDrop(
    card: TaskView,
    taskId: string,
    from: string,
    to: string,
    overTask: string | null,
  ) {
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
        // PR #35 review item 1: a paged column (Load more) shows the lead query's server count, so the move is
        // counted there too; rolled back with the snapshot on failure, replaced by the regroup re-read on success.
        if (from !== to) {
          const already = group === 'assignee' && (card.assigneeIds ?? []).includes(to)
          qc.setQueryData<InfiniteData<ViewQueryResponse>>(leadQueryKey, (d) =>
            moveCount(d, from, already ? null : to),
          )
        }
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

  // The column title in the vocabulary of its group: a status badge, a priority badge or the person's avatar.
  function headingOf(column: Column) {
    if (group === 'status') {
      const status = statuses.data?.statuses?.find(
        (s) => (s.name ?? '').trim().toLowerCase() === column.key,
      )
      if (status) return <StatusValue status={status} />
    } else if (group === 'priority') {
      return <PriorityValue priority={column.key as Priority} />
    } else if (group === 'assignee' && column.key !== 'none') {
      return (
        <>
          <Avatar name={column.label} size={20} />
          <span className="truncate">{column.label}</span>
        </>
      )
    }
    return <span className="truncate">{column.label}</span>
  }

  if (columns.length === 0 && lead.isPending) {
    return (
      <div role="status" aria-label="Loading the Board" className="flex gap-3 overflow-x-auto pb-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex w-[268px] shrink-0 flex-col gap-2 p-2">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: 3 }, (_, j) => (
              <Skeleton key={j} className="h-16 w-full" />
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (columns.length === 0 && lead.isError) {
    return <ErrorState message={messageOf(lead.error)} onRetry={() => void lead.refetch()} />
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
        {lead.isError && columns.length > 0 && (
          <div className="mb-2">
            <ErrorState message={messageOf(lead.error)} onRetry={() => void lead.refetch()} />
          </div>
        )}
        <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Board">
          {columns.map((column) => (
            <BoardColumn
              key={column.key}
              column={column}
              heading={headingOf(column)}
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
              <EmptyState title="No tasks in this view." />
            ))}
        </div>
      </DndContext>
      {guard.dialog}
    </>
  )
}
