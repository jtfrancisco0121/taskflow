import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useMatch, useNavigate, type Location } from 'react-router'
import { messageOf } from '../../api/errors'
import type { FieldView, TaskView, ViewConfig } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Checkbox } from '../../shared/ui/Checkbox'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { BlockedBadge } from '../dependencies'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { BulkBar } from './BulkBar'
import { ColumnsPicker } from './ColumnsPicker'
import { EditableText, TagsCell } from './cells'
import { AssigneeEditor, DueEditor, PriorityEditor, StatusEditor } from './ListEditors'
import { FieldCell } from './FieldCell'
import { groupLabel } from './groupLabels'
import { DroppedNotice, NoMatches, hasFilter } from './ResultNotices'
import type { Column, UrlState } from './urlState'
import type { ViewScope } from './scope'
import { observeRect } from './virtualRect'
import { useScopeFields, customColumns } from './useScopeFields'
import { useTaskActions } from './useTaskActions'
import { useViewTasks } from './useViewTasks'
import { useListKeys } from './useListKeys'
import { useTaskOrder } from '../../shared/task-order'
import { useViewStore } from './viewStore'

const ROW_HEIGHT = 36

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
  const navigate = useNavigate()
  const location = useLocation()
  const onTaskRoute = useMatch('/t/:taskId') !== null
  // The task panel opens over the place it was opened from.
  const background = onTaskRoute
    ? ((location.state as { backgroundLocation?: Location } | null)?.backgroundLocation ?? null)
    : location
  const linkState = background ? { backgroundLocation: background } : undefined
  const openTask = (id: string) => void navigate(`/t/${id}`, { state: linkState })
  const selectedIds = useViewStore((s) => s.selected)
  const focusedTaskId = useViewStore((s) => s.focusedTaskId)
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

  const loaded = query.items.flatMap((i) => (i.task ? [i.task] : []))
  const taskRows = rows.flatMap((row, rowIndex) =>
    row.kind === 'task' ? [{ rowIndex, task: row.task }] : [],
  )
  const onKeyDown = useListKeys({ scope, taskRows, loaded, virtualizer, openTask })
  const firstTaskId = taskRows[0]?.task.id
  // The task detail reads the display order for j/k; collapsed groups are not in it.
  const order = taskRows.map((r) => r.task.id).join(',')
  useEffect(() => {
    useTaskOrder.getState().setIds(order ? order.split(',') : [])
  }, [order])
  useEffect(() => () => useTaskOrder.getState().setIds([]), [])

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading tasks" className="flex flex-col gap-px">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (query.isError) {
    return <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
  }

  return (
    <div>
      <DroppedNotice dropped={query.droppedFields} config={config} update={update} />
      {update && (
        <ColumnsPicker
          columns={(config.columns as Column[] | undefined) ?? [{ field: 'title' }]}
          fields={scopeFields.fields}
          builtIn={false}
          onChange={(c) => update({ c })}
        />
      )}
      <BulkBar scope={scope} tasks={loaded} members={members} />
      {rows.length === 0 &&
        (hasFilter(config) ? <NoMatches update={update} /> : <EmptyState title={empty} />)}
      {rows.length > 0 && (
        <div role="table" aria-label="Tasks" aria-rowcount={rows.length} onKeyDown={onKeyDown}>
          <div
            role="row"
            className="grid border-b border-line px-2 py-1 text-xs font-medium text-muted uppercase"
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
                    aria-selected={
                      row.kind === 'task' ? selectedIds.includes(row.task.id!) : undefined
                    }
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
                        className="flex h-full w-full items-center gap-2 bg-surface-2 px-2 text-left text-[13px] font-semibold text-fg"
                      >
                        <span aria-hidden>{collapsed[row.key] ? '▸' : '▾'}</span>
                        {row.label}
                        <span className="font-normal text-muted">{row.count ?? ''}</span>
                      </button>
                    ) : (
                      <TaskLine
                        task={row.task}
                        names={names}
                        members={members}
                        custom={custom}
                        template={template}
                        linkState={linkState}
                        tabbable={
                          row.task.id === focusedTaskId ||
                          (!taskRows.some((r) => r.task.id === focusedTaskId) &&
                            row.task.id === firstTaskId)
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {isFetchingNextPage && <p className="mt-1 text-[13px] text-muted">Loading more…</p>}
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
  linkState,
  tabbable,
}: {
  linkState: { backgroundLocation: Location } | undefined
  tabbable: boolean
  task: TaskView
  names: Map<string, string>
  members: Array<{ userId?: string; displayName?: string; email?: string }>
  custom: FieldView[]
  template: string
}) {
  const actions = useTaskActions()
  const navigate = useNavigate()
  const open = useMatch('/t/:taskId')?.params.taskId === task.id
  const selected = useViewStore((s) => s.selected.includes(task.id!))
  const toggle = useViewStore((s) => s.toggleSelected)
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const statusList = statuses.data?.statuses ?? []
  const done = ['DONE', 'CLOSED'].includes(
    statusList.find((st) => st.id === task.statusId)?.group ?? '',
  )
  const closeEditor = useViewStore((st) => st.setOpenEditor)
  const setFocused = useViewStore((st) => st.setFocusedTaskId)
  const id = task.id!
  useEffect(
    () => () => {
      // The row went away (scrolled out, trashed, filtered): its editor must not stay "open".
      if (useViewStore.getState().openEditor?.taskId === id) closeEditor(null)
    },
    [id, closeEditor],
  )
  return (
    <div
      data-task-id={task.id}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => setFocused(id)}
      aria-current={open ? 'true' : undefined}
      onClick={() => void navigate(`/t/${task.id}`, { state: linkState })}
      style={{ gridTemplateColumns: template }}
      className={`grid h-full cursor-pointer items-center border-b border-line px-2 text-[13px] text-fg hover:bg-surface-2 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:bg-surface-2 focus-visible:shadow-[inset_3px_0_0_var(--tf-accent)] ${open || selected ? 'bg-accent-soft' : ''}`}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          aria-label={`Select ${task.title}`}
          checked={selected}
          onCheckedChange={() => toggle(task.id!)}
        />
      </span>
      <span className="font-mono text-xs text-muted">{task.readableId}</span>
      <EditableText
        value={task.title ?? ''}
        label={`Title of ${task.readableId}`}
        className="flex min-w-0 items-center gap-1"
        onSave={(title) => void actions.patch(task, { title })}
      >
        <Link
          to={`/t/${task.id}`}
          state={linkState}
          onClick={(e) => e.stopPropagation()}
          className="truncate hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          {task.title}
        </Link>
        <BlockedBadge blocked={task.blocked} count={task.blockerCount} />
      </EditableText>
      <StatusEditor task={task} statuses={statusList} />
      <PriorityEditor task={task} />
      <AssigneeEditor task={task} members={members} names={names} />
      <DueEditor task={task} done={done} />
      <TagsCell
        label={`Tags of ${task.readableId}`}
        tags={task.tags ?? []}
        onChange={(tags) => void actions.patch(task, { tags })}
      />
      {custom.map((field) => (
        <FieldCell key={field.id} field={field} task={task} />
      ))}
    </div>
  )
}
