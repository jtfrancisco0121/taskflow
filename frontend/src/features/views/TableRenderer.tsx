import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { messageOf } from '../../api/errors'
import type { FieldView, TaskView, ViewConfig } from '../../api/types'
import { formatDateTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { BlockedBadge } from '../dependencies'
import { useLocationInfo } from '../locations'
import { useLocationStatuses } from '../statuses'
import { PRIORITIES, PRIORITY_LABEL, initialsOf } from '../tasks'
import { useMembers } from '../workspace'
import { ColumnsPicker } from './ColumnsPicker'
import { DroppedNotice, NoMatches, hasFilter } from './ResultNotices'
import { DateCell, EditableText, MultiPickCell, SelectCell, TagsCell } from './cells'
import { FieldCell } from './FieldCell'
import { useScopeFields } from './useScopeFields'
import type { ViewScope } from './scope'
import { observeRect } from './virtualRect'
import {
  COLUMN_LABEL,
  DEFAULT_COLUMNS,
  DEFAULT_WIDTH,
  clampWidth,
  dropColumn,
  moveColumn,
  withWidth,
} from './tableColumns'
import { isCustomRef, type Column, type UrlState } from './urlState'
import { useGuardedStatus } from './useGuardedStatus'
import { useTaskActions } from './useTaskActions'
import { useViewTasks } from './useViewTasks'

const ROW_HEIGHT = 40
const helper = createColumnHelper<TaskView>()

/** TABLE-1: resizable, reorderable columns written to the URL `c`, with in-place editors. */
export function TableRenderer({
  scope,
  config,
  update,
}: {
  scope: ViewScope
  config: ViewConfig
  update: (patch: Partial<UrlState>) => void
}) {
  const { fields, byId } = useScopeFields(scope)
  const requested: Column[] = config.columns?.length
    ? (config.columns as Column[])
    : DEFAULT_COLUMNS
  // A custom column whose field is gone, hidden or not offered at this scope is not drawn.
  const columns = requested.filter(
    (c) => !isCustomRef(c.field) || !fields.length || byId.has(c.field.slice(3)),
  )
  const labelOf = (field: string) =>
    isCustomRef(field)
      ? (byId.get(field.slice(3))?.name ?? 'Custom field')
      : (COLUMN_LABEL[field] ?? field)
  const query = useViewTasks(scope, { ...config, group: 'none' })
  // A stable `data` reference: a new array every render makes TanStack Table reset its state in a loop.
  const tasks = useMemo(() => query.items.flatMap((i) => (i.task ? [i.task] : [])), [query.items])
  const [dragWidth, setDragWidth] = useState<{ field: string; width: number } | null>(null)
  const setColumns = (next: Column[]) => update({ c: next })

  const defs: ColumnDef<TaskView, unknown>[] = columns.map((c) =>
    helper.display({
      id: c.field,
      header: labelOf(c.field),
      size: c.width ?? DEFAULT_WIDTH,
    }),
  ) as ColumnDef<TaskView, unknown>[]
  const table = useReactTable({
    data: tasks,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id!,
    state: {
      columnOrder: columns.map((c) => c.field),
      columnSizing: Object.fromEntries(
        columns.map((c) => [
          c.field,
          dragWidth?.field === c.field ? dragWidth.width : (c.width ?? DEFAULT_WIDTH),
        ]),
      ),
    },
  })
  const headers = table.getHeaderGroups()[0]?.headers ?? []
  const template = headers.map((h) => `${h.getSize()}px`).join(' ')

  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 1000, height: 600 },
    observeElementRect: observeRect,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const last = virtualItems.at(-1)?.index ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && last >= rows.length - 10) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, last, rows.length])

  function startResize(event: React.PointerEvent, field: string, startWidth: number) {
    event.preventDefault()
    const startX = event.clientX
    let width = startWidth
    const move = (e: PointerEvent) => {
      width = clampWidth(startWidth + e.clientX - startX)
      setDragWidth({ field, width })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragWidth(null)
      setColumns(withWidth(columns, field, width))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onHeaderKey(event: React.KeyboardEvent, field: string, width: number) {
    if (!event.altKey) return
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!direction) return
    event.preventDefault()
    if (event.shiftKey) setColumns(withWidth(columns, field, width + 20 * direction))
    else setColumns(moveColumn(columns, field, direction))
  }

  if (query.isError) {
    return (
      <p role="alert" className="flex items-center gap-2 text-red-700">
        {messageOf(query.error)}
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </p>
    )
  }

  return (
    <div>
      <DroppedNotice dropped={query.droppedFields} config={config} update={update} />
      <ColumnsPicker columns={columns} fields={fields} builtIn onChange={setColumns} />
      <div role="grid" aria-label="Tasks table" aria-rowcount={rows.length}>
        <div
          role="row"
          className="grid border-b border-slate-200 text-xs text-slate-500 uppercase"
          style={{ gridTemplateColumns: template }}
        >
          {headers.map((header) => {
            const width = header.getSize()
            return (
              <div
                key={header.id}
                role="columnheader"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', header.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  setColumns(dropColumn(columns, e.dataTransfer.getData('text/plain'), header.id))
                }}
                className="relative px-2 py-1"
              >
                <button
                  type="button"
                  className="w-full text-left uppercase"
                  aria-label={`${labelOf(header.id)} column, width ${width}`}
                  onKeyDown={(e) => onHeaderKey(e, header.id, width)}
                >
                  {labelOf(header.id)}
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${labelOf(header.id)}`}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-300"
                  onPointerDown={(e) => startResize(e, header.id, width)}
                />
              </div>
            )
          })}
        </div>
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((v) => {
              const row = rows[v.index]
              return (
                <div
                  key={row.id}
                  role="row"
                  data-task-id={row.original.id}
                  className="grid items-center border-b border-slate-100 text-sm"
                  style={{
                    gridTemplateColumns: template,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: ROW_HEIGHT,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {headers.map((h) => (
                    <div key={h.id} role="gridcell" className="truncate px-2">
                      <Cell
                        field={h.id}
                        task={row.original}
                        scope={scope}
                        custom={byId.get(h.id.slice(3))}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {query.isSuccess && rows.length === 0 && hasFilter(config) && <NoMatches update={update} />}
      {hasNextPage && (
        <Button className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  )
}

function Cell({
  field,
  task,
  scope,
  custom,
}: {
  field: string
  task: TaskView
  scope: ViewScope
  custom?: FieldView
}) {
  const actions = useTaskActions()
  const guardedStatus = useGuardedStatus()
  const location = useLocation()
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const { members } = useMembers(scope.workspaceId)
  const list = useLocationInfo(field === 'list' ? task.listId : undefined)
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const id = task.readableId
  if (isCustomRef(field)) return custom ? <FieldCell field={custom} task={task} /> : null
  switch (field) {
    case 'readableId':
      return <span className="font-mono text-xs text-slate-500">{task.readableId}</span>
    case 'title':
      return (
        <EditableText
          value={task.title ?? ''}
          label={`Title of ${id}`}
          className="flex min-w-0 items-center gap-1"
          onSave={(title) => void actions.patch(task, { title })}
        >
          <Link
            to={`/t/${task.id}`}
            state={{ backgroundLocation: location }}
            className="truncate hover:underline"
          >
            {task.title}
          </Link>
          <BlockedBadge blocked={task.blocked} count={task.blockerCount} />
        </EditableText>
      )
    case 'status':
      return (
        <>
          <SelectCell
            label={`Status of ${id}`}
            value={task.statusId ?? ''}
            options={(statuses.data?.statuses ?? []).map((s) => ({
              value: s.id!,
              label: s.name ?? '',
            }))}
            onChange={(statusId) =>
              void guardedStatus.change(task, statusId, statuses.data?.statuses ?? [])
            }
          />
          {guardedStatus.dialog}
        </>
      )
    case 'priority':
      return (
        <SelectCell
          label={`Priority of ${id}`}
          value={task.priority ?? 'NONE'}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          onChange={(priority) =>
            void actions.patch(task, { priority: priority as TaskView['priority'] })
          }
        />
      )
    case 'assignees':
      return (
        <MultiPickCell
          label={`Assignees of ${id}`}
          options={members.map((m) => ({
            value: m.userId!,
            label: m.displayName ?? m.email ?? '',
          }))}
          selected={task.assigneeIds ?? []}
          onChange={(assigneeIds) => void actions.patch(task, { assigneeIds })}
          summary={
            (task.assigneeIds ?? []).length
              ? (task.assigneeIds ?? []).map((a) => initialsOf(names.get(a) ?? '?')).join(' ')
              : '—'
          }
        />
      )
    case 'dueDate':
    case 'startDate':
      return (
        <DateCell
          label={`${field === 'dueDate' ? 'Due' : 'Start'} date of ${id}`}
          value={task[field]}
          onChange={(day) => void actions.patch(task, { [field]: day as string })}
        />
      )
    case 'tags':
      return (
        <TagsCell
          label={`Tags of ${id}`}
          tags={task.tags ?? []}
          onChange={(tags) => void actions.patch(task, { tags })}
        />
      )
    case 'list':
      return <span>{list.data?.name ?? ''}</span>
    case 'createdAt':
    case 'updatedAt':
      return <span className="text-slate-600">{formatDateTime(task[field])}</span>
    default:
      return null
  }
}
