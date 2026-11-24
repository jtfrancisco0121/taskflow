import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useMatch, useNavigate, type Location } from 'react-router'
import { messageOf } from '../../api/errors'
import type { FieldView, TaskView, ViewConfig } from '../../api/types'
import { formatDay } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { useLocationStatuses } from '../statuses'
import { PRIORITIES, PRIORITY_LABEL, initialsOf } from '../tasks'
import { useMembers } from '../workspace'
import { BulkBar } from './BulkBar'
import { ColumnsPicker } from './ColumnsPicker'
import { DateCell, EditableText, MultiPickCell, SelectCell, TagsCell } from './cells'
import { FieldCell } from './FieldCell'
import { groupLabel } from './groupLabels'
import type { Column, UrlState } from './urlState'
import type { ViewScope } from './scope'
import { observeRect } from './virtualRect'
import { useScopeFields, customColumns } from './useScopeFields'
import { useTaskActions } from './useTaskActions'
import { useViewTasks } from './useViewTasks'
import { useViewStore } from './viewStore'

const ROW_HEIGHT = 40

type Row =
  | { kind: 'header'; key: string; label: string; count: number | undefined }
  | { kind: 'task'; key: string; task: TaskView }

/** LIST-1: grouped rows with counts and collapse, virtualized, inline editors and Bulk actions. */
export function ListRenderer({
  scope,
  config,
  empty = 'No tasks in this view.',
  update,
}: {
  scope: ViewScope
  config: ViewConfig
  empty?: string
  update?: (patch: Partial<UrlState>) => void
}) {
  const query = useViewTasks(scope, config)
  const scopeFields = useScopeFields(scope)
  const custom = customColumns(config.columns, scopeFields.byId).map((c) => c.field)
  const template = `2rem 6rem minmax(12rem,1fr) 9rem 7rem 8rem 9rem 9rem${' 10rem'.repeat(custom.length)}`
  const { members } = useMembers(scope.workspaceId)
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const collapsed = useViewStore((s) => s.collapsed)
  const toggleGroup = useViewStore((s) => s.toggleGroup)
  const grouped = !!config.group && config.group !== 'none'

  const rows: Row[] = []
  let current: string | undefined
  for (const item of query.items) {
    if (!item.task) continue
    if (grouped && item.group !== current) {
      current = item.group
      const info = query.groups?.find((g) => g.key === item.group)
      rows.push({
        kind: 'header',
        key: `h:${item.group}`,
        label: groupLabel(config.group, item.group ?? '', info?.label, names),
        count: info?.count,
      })
    }
    if (grouped && collapsed[`h:${item.group}`]) continue
    rows.push({ kind: 'task', key: `${item.group ?? ''}:${item.task.id}`, task: item.task })
  }

  const scrollRef = useRef<HTMLDivElement>(null)
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

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading tasks" className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-slate-200" />
        ))}
      </div>
    )
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
      {update && (
        <ColumnsPicker
          columns={(config.columns as Column[] | undefined) ?? [{ field: 'title' }]}
          fields={scopeFields.fields}
          builtIn={false}
          onChange={(c) => update({ c })}
        />
      )}
      <BulkBar
        scope={scope}
        tasks={query.items.flatMap((i) => (i.task ? [i.task] : []))}
        members={members}
      />
      {rows.length === 0 && <p className="mb-2 text-slate-600">{empty}</p>}
      {rows.length > 0 && (
        <div role="table" aria-label="Tasks" aria-rowcount={rows.length}>
          <div
            role="row"
            className="grid border-b border-slate-200 px-2 py-1 text-xs text-slate-500 uppercase"
            style={{ gridTemplateColumns: template }}
          >
            <span />
            <span role="columnheader">ID</span>
            <span role="columnheader">Title</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">Assignees</span>
            <span role="columnheader">Due</span>
            <span role="columnheader">Tags</span>
            {custom.map((f) => (
              <span key={f.id} role="columnheader" title={`from ${f.definedAtName}`}>
                {f.name}
              </span>
            ))}
          </div>
          <div ref={scrollRef} className="max-h-[70vh] overflow-auto" data-testid="list-scroll">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((v) => {
                const row = rows[v.index]
                return (
                  <div
                    key={row.key}
                    role="row"
                    data-index={v.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: ROW_HEIGHT,
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    {row.kind === 'header' ? (
                      <button
                        type="button"
                        aria-expanded={!collapsed[row.key]}
                        onClick={() => toggleGroup(row.key)}
                        className="flex h-full w-full items-center gap-2 bg-slate-100 px-2 text-left text-sm font-semibold"
                      >
                        <span aria-hidden>{collapsed[row.key] ? '▸' : '▾'}</span>
                        {row.label}
                        <span className="font-normal text-slate-500">{row.count ?? ''}</span>
                      </button>
                    ) : (
                      <TaskLine
                        task={row.task}
                        names={names}
                        members={members}
                        custom={custom}
                        template={template}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {isFetchingNextPage && <p className="mt-1 text-sm text-slate-500">Loading more…</p>}
      {hasNextPage && (
        <Button className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  )
}

function TaskLine({
  task,
  names,
  members,
  custom,
  template,
}: {
  task: TaskView
  names: Map<string, string>
  members: Array<{ userId?: string; displayName?: string; email?: string }>
  custom: FieldView[]
  template: string
}) {
  const actions = useTaskActions()
  const navigate = useNavigate()
  const location = useLocation()
  const onTaskRoute = useMatch('/t/:taskId') !== null
  const background = onTaskRoute
    ? ((location.state as { backgroundLocation?: Location } | null)?.backgroundLocation ?? null)
    : location
  const linkState = background ? { backgroundLocation: background } : undefined
  const open = useMatch('/t/:taskId')?.params.taskId === task.id
  const selected = useViewStore((s) => s.selected.includes(task.id!))
  const toggle = useViewStore((s) => s.toggleSelected)
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const options = (statuses.data?.statuses ?? []).map((s) => ({
    value: s.id!,
    label: s.name ?? '',
  }))
  const memberOptions = members.map((m) => ({
    value: m.userId!,
    label: m.displayName ?? m.email ?? '',
  }))
  const assignees = task.assigneeIds ?? []

  return (
    <div
      data-task-id={task.id}
      aria-current={open ? 'true' : undefined}
      onClick={() => void navigate(`/t/${task.id}`, { state: linkState })}
      style={{ gridTemplateColumns: template }}
      className={`grid h-full cursor-pointer items-center border-b border-slate-100 px-2 text-sm hover:bg-slate-50 ${open ? 'bg-blue-50' : ''}`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${task.title}`}
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggle(task.id!)}
      />
      <span className="font-mono text-xs text-slate-500">{task.readableId}</span>
      <EditableText
        value={task.title ?? ''}
        label={`Title of ${task.readableId}`}
        className="truncate"
        onSave={(title) => void actions.patch(task, { title })}
      >
        <Link
          to={`/t/${task.id}`}
          state={linkState}
          onClick={(e) => e.stopPropagation()}
          className="hover:underline focus:outline-2 focus:outline-blue-600"
        >
          {task.title}
        </Link>
      </EditableText>
      <SelectCell
        label={`Status of ${task.readableId}`}
        value={task.statusId ?? ''}
        options={options}
        onChange={(statusId) => void actions.patch(task, { statusId })}
      />
      <SelectCell
        label={`Priority of ${task.readableId}`}
        value={task.priority ?? 'NONE'}
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        onChange={(priority) =>
          void actions.patch(task, { priority: priority as TaskView['priority'] })
        }
      />
      <MultiPickCell
        label={`Assignees of ${task.readableId}`}
        options={memberOptions}
        selected={assignees}
        onChange={(assigneeIds) => void actions.patch(task, { assigneeIds })}
        summary={
          <span className="flex gap-1">
            {assignees.length === 0 && <span className="text-slate-400">—</span>}
            {assignees.map((id) => (
              <span
                key={id}
                title={names.get(id) ?? 'Former member'}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-medium"
              >
                {initialsOf(names.get(id) ?? '?')}
              </span>
            ))}
          </span>
        }
      />
      <DateCell
        label={`Due date of ${task.readableId}`}
        value={task.dueDate}
        onChange={(dueDate) => void actions.patch(task, { dueDate: dueDate as string })}
      />
      <TagsCell
        label={`Tags of ${task.readableId}`}
        tags={task.tags ?? []}
        onChange={(tags) => void actions.patch(task, { tags })}
      />
      {custom.map((field) => (
        <FieldCell key={field.id} field={field} task={task} />
      ))}
      <span className="sr-only">{formatDay(task.dueDate)}</span>
    </div>
  )
}
