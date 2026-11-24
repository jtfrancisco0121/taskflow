import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { messageOf } from '../../api/errors'
import type { TaskView, ViewConfig } from '../../api/types'
import { formatDateTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { useLocationInfo } from '../locations'
import { useLocationStatuses } from '../statuses'
import { PRIORITIES, PRIORITY_LABEL, initialsOf } from '../tasks'
import { useMembers } from '../workspace'
import { DateCell, EditableText, MultiPickCell, SelectCell, TagsCell } from './cells'
import type { ViewScope } from './scope'
import { observeRect } from './virtualRect'
import {
  COLUMN_LABEL,
  DEFAULT_COLUMNS,
  DEFAULT_WIDTH,
  clampWidth,
  dropColumn,
  moveColumn,
  toggleColumn,
  withWidth,
} from './tableColumns'
import { COLUMN_FIELDS, type Column, type UrlState } from './urlState'
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
  const columns: Column[] = config.columns?.length ? (config.columns as Column[]) : DEFAULT_COLUMNS
  const query = useViewTasks(scope, { ...config, group: 'none' })
  const tasks = query.items.flatMap((i) => (i.task ? [i.task] : []))
  const [dragWidth, setDragWidth] = useState<{ field: string; width: number } | null>(null)
  const setColumns = (next: Column[]) => update({ c: next })

  const defs: ColumnDef<TaskView, unknown>[] = columns.map((c) =>
    helper.display({
      id: c.field,
      header: COLUMN_LABEL[c.field] ?? c.field,
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
      <p role="alert" className="text-red-700">
        {messageOf(query.error)}
      </p>
    )
  }

  return (
    <div>
      <details className="mb-2 text-sm">
        <summary className="cursor-pointer">Columns</summary>
        <div className="mt-1 flex flex-wrap gap-3">
          {COLUMN_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={columns.some((c) => c.field === field)}
                disabled={field === 'title'}
                onChange={(e) => setColumns(toggleColumn(columns, field, e.target.checked))}
              />
              {COLUMN_LABEL[field] ?? field}
            </label>
          ))}
        </div>
      </details>
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
                  aria-label={`${COLUMN_LABEL[header.id] ?? header.id} column, width ${width}`}
                  onKeyDown={(e) => onHeaderKey(e, header.id, width)}
                >
                  {COLUMN_LABEL[header.id] ?? header.id}
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${COLUMN_LABEL[header.id] ?? header.id}`}
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
                      <Cell field={h.id} task={row.original} scope={scope} />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {hasNextPage && (
        <Button className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  )
}

function Cell({ field, task, scope }: { field: string; task: TaskView; scope: ViewScope }) {
  const actions = useTaskActions()
  const location = useLocation()
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const { members } = useMembers(scope.workspaceId)
  const list = useLocationInfo(field === 'list' ? task.listId : undefined)
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const id = task.readableId
  switch (field) {
    case 'readableId':
      return <span className="font-mono text-xs text-slate-500">{task.readableId}</span>
    case 'title':
      return (
        <EditableText
          value={task.title ?? ''}
          label={`Title of ${id}`}
          onSave={(title) => void actions.patch(task, { title })}
        >
          <Link
            to={`/t/${task.id}`}
            state={{ backgroundLocation: location }}
            className="hover:underline"
          >
            {task.title}
          </Link>
        </EditableText>
      )
    case 'status':
      return (
        <SelectCell
          label={`Status of ${id}`}
          value={task.statusId ?? ''}
          options={(statuses.data?.statuses ?? []).map((s) => ({
            value: s.id!,
            label: s.name ?? '',
          }))}
          onChange={(statusId) => void actions.patch(task, { statusId })}
        />
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
