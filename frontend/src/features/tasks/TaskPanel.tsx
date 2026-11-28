import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { ApiError, messageOf } from '../../api/errors'
import type { StatusInfo, TaskView } from '../../api/types'
import { formatDay } from '../../shared/dates'
import { RichTextEditor, isEmptyDoc, type RichDoc } from '../../shared/richtext'
import { Button } from '../../shared/ui/Button'
import { useNavigate, useLocation } from 'react-router'
import { useTaskOrder } from '../../shared/task-order'
import { Dialog } from '../../shared/ui/Dialog'
import { isShortcutBlocked } from '../../shared/ui/shortcutGuard'
import { readTaskDetailMode, useUiStore } from '../../shared/ui-store'
import {
  BlockedBadge,
  DependenciesSection,
  completesTask,
  useCompletionGuard,
} from '../dependencies'
import { formatValue, useLocationFields } from '../fields'
import { useLocationStatuses } from '../statuses'
import { WatchControl } from '../notifications'
import { useMembers } from '../workspace'
import { ConflictBanner, type ConflictChange } from './ConflictBanner'
import { CustomFieldsGroup } from './CustomFieldsGroup'
import { FieldShell } from './FieldShell'
import { PRIORITY_LABEL } from './labels'
import {
  AssigneesField,
  DateField,
  PriorityField,
  StatusField,
  TagsField,
  TitleField,
} from './TaskFields'
import { useFieldHints } from './useFieldHints'
import { ChecklistsSection } from './ChecklistsSection'
import { ParentLink, SubtasksSection } from './SubtasksSection'
import { useTask } from './useTask'
import { useUpdateTask, type TaskPatch } from './useUpdateTask'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

/** Which hint slot and label each patch key belongs to. */
const FIELD_OF: Record<keyof TaskPatch, { field: string; label: string }> = {
  title: { field: 'title', label: 'Title' },
  statusId: { field: 'status', label: 'Status' },
  priority: { field: 'priority', label: 'Priority' },
  startDate: { field: 'startDate', label: 'Start date' },
  dueDate: { field: 'dueDate', label: 'Due date' },
  tags: { field: 'tags', label: 'Tags' },
  assigneeIds: { field: 'assignees', label: 'Assignees' },
  description: { field: 'description', label: 'Description' },
  parentTaskId: { field: 'parentTaskId', label: 'Parent task' },
  customFields: { field: 'customFields', label: 'Custom fields' },
}

type TaskPanelProps = {
  taskId: string
  onClose: () => void
  /** Tabs (comments, activity) mounted by the route through their feature's index. */
  children?: (task: TaskView) => ReactNode
}

/**
 * AD-2: Escape closes the detail unless it comes from inside a rich-text editor (the comment composer, a comment
 * being edited, the description), which owns it. Text inputs that hold a draft stop Escape themselves.
 */
export function escapeClosesDetail(event: { target: EventTarget | null }): boolean {
  return !(event.target as HTMLElement | null)?.closest?.('[contenteditable="true"]')
}

const SKELETON = (
  <div aria-busy="true" className="flex animate-pulse flex-col gap-3 p-4">
    <div className="h-6 rounded bg-surface-3" />
    <div className="h-4 rounded bg-surface-3" />
    <div className="h-4 rounded bg-surface-3" />
  </div>
)

/**
 * The task detail (AD-1, AD-2): one body in two frames, a modal Dialog or a docked complementary panel, chosen by
 * the person and remembered. A task switch (the route's id changes) swaps only the body; the frame stays.
 */
export function TaskPanel({ taskId, onClose, children }: TaskPanelProps) {
  const query = useTask(taskId)
  const task = query.data
  const stored = useUiStore((state) => state.taskDetailMode)
  const setMode = useUiStore((state) => state.setTaskDetailMode)
  const mode = stored ?? readTaskDetailMode()
  const titleRef = useRef<HTMLInputElement>(null)
  // The element the body focused on mount: the modal Dialog focuses the same one (its effect runs after the body's).
  const focusRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLElement>(null)
  // Where focus goes when a body mounts: the title on a fresh open, the frame after a task switch (the body of
  // the previous task was shown), the toggle after a frame switch. Refs are read only from effects and handlers.
  const shown = useRef<string | null>(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (task) shown.current = task.id ?? null
    // The next task is loading and the old body is gone: keep focus in the frame, so j/k go on working.
    else if (shown.current && document.activeElement === document.body) frameRef.current?.focus()
  })
  // StrictMode runs a mount effect twice: the answer for one body must not change between the two runs.
  const decided = useRef<{ id: string | undefined; target: 'title' | 'frame' | 'toggle' } | null>(
    null,
  )
  const takeFocusTarget = (id: string | undefined): 'title' | 'frame' | 'toggle' => {
    if (decided.current && decided.current.id === id && !toggled.current)
      return decided.current.target
    const target = toggled.current
      ? 'toggle'
      : shown.current && shown.current !== id
        ? 'frame'
        : 'title'
    toggled.current = false
    decided.current = { id, target }
    return target
  }

  const navigate = useNavigate()
  const location = useLocation()
  // AD-6: j/ArrowDown and k/ArrowUp open the next/previous task of the List behind, in the same frame and with no
  // history entry per step. The shared guard ignores this frame's own dialog and keeps every other layer busy.
  function onFrameKeyDown(event: KeyboardEvent<HTMLElement>) {
    const key = event.key
    const step = key === 'j' || key === 'ArrowDown' ? 1 : key === 'k' || key === 'ArrowUp' ? -1 : 0
    if (!step || event.defaultPrevented) return
    if (isShortcutBlocked(event.nativeEvent, { host: event.currentTarget })) return
    const ids = useTaskOrder.getState().ids
    const at = ids.indexOf(taskId)
    const next = at < 0 ? undefined : ids[at + step]
    if (!next) return
    event.preventDefault()
    void navigate(`/t/${next}`, { replace: true, state: location.state })
  }

  const name = `Task ${task?.readableId ?? ''}`.trim()
  const status = query.error instanceof ApiError ? query.error.status : 0
  // 14yq6g334fe: a failed background refresh keeps the task on screen with a RefreshNotice; only a failed first load
  // (or a task that came back empty) shows the error screen.
  const failed = loadFailed(query) || (hasData(query) && !task)
  const content = failed ? (
    <div className="flex flex-col items-start gap-3 p-4">
      <p>
        {status === 403 || status === 404
          ? 'This task is gone or you can’t see it.'
          : messageOf(query.error)}
      </p>
      {status !== 403 && status !== 404 && loadFailed(query) && (
        <Button onClick={() => void query.refetch()}>Retry</Button>
      )}
      <Button onClick={onClose}>Close</Button>
    </div>
  ) : !task ? (
    SKELETON
  ) : (
    <>
      {refreshFailed(query) && (
        <div className="px-4 pt-2">
          <RefreshNotice message={messageOf(query.error)} onRetry={() => void query.refetch()} />
        </div>
      )}
      <TaskDetailBody
        key={task.id}
        task={task}
        layout={mode}
        titleRef={titleRef}
        focusRef={focusRef}
        takeFocusTarget={takeFocusTarget}
        onClose={onClose}
        onToggle={() => {
          toggled.current = true
          setMode(mode === 'modal' ? 'docked' : 'modal')
        }}
      >
        {children}
      </TaskDetailBody>
    </>
  )

  if (mode === 'modal') {
    return (
      <Dialog
        title={name}
        size="task"
        initialFocus={focusRef}
        closeOnEscape={escapeClosesDetail}
        onClose={onClose}
      >
        <div
          ref={frameRef as RefObject<HTMLDivElement>}
          tabIndex={-1}
          onKeyDown={onFrameKeyDown}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {content}
        </div>
      </Dialog>
    )
  }
  return (
    <aside
      ref={frameRef as RefObject<HTMLElement>}
      role="complementary"
      aria-label={name}
      tabIndex={-1}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        onFrameKeyDown(event)
        if (event.key !== 'Escape' || event.defaultPrevented || !escapeClosesDetail(event)) return
        event.stopPropagation()
        onClose()
      }}
      className="flex h-full min-h-0 w-[600px] max-w-[60%] shrink-0 flex-col overflow-auto border-l border-line bg-surface outline-none"
    >
      {content}
    </aside>
  )
}

type BodyProps = {
  task: TaskView
  layout: 'modal' | 'docked'
  titleRef: RefObject<HTMLInputElement | null>
  focusRef: RefObject<HTMLElement | null>
  takeFocusTarget: (id: string | undefined) => 'title' | 'frame' | 'toggle'
  onClose: () => void
  onToggle: () => void
  children?: (task: TaskView) => ReactNode
}

function TaskDetailBody({
  task,
  layout,
  titleRef,
  focusRef,
  takeFocusTarget,
  onClose,
  onToggle,
  children,
}: BodyProps) {
  const update = useUpdateTask(task.id!)
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const statusList: StatusInfo[] = statuses.data?.statuses ?? []
  const { members } = useMembers(task.workspaceId)
  const memberList = members.map((m) => ({ id: m.userId!, name: m.displayName ?? m.email ?? '' }))
  const customFields = useLocationFields(task.listId)
  const { hints, set } = useFieldHints()
  const guard = useCompletionGuard()
  const [conflict, setConflict] = useState<TaskPatch | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const where = takeFocusTarget(task.id)
    const target =
      where === 'toggle'
        ? toggleRef.current
        : where === 'frame'
          ? rootRef.current?.parentElement
          : titleRef.current
    focusRef.current = target ?? null
    target?.focus()
    // Focus moves in once, when this body mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(field: string, label: string, patch: TaskPatch): Promise<boolean> {
    set(field, { state: 'saving' })
    try {
      const result = await update.mutateAsync(patch)
      if (result.kind === 'saved') {
        set(field, { state: 'saved' })
        setConflict((current) => {
          if (!current) return null
          const rest = { ...current }
          for (const key of Object.keys(patch)) delete rest[key as keyof TaskPatch]
          return Object.keys(rest).length ? rest : null
        })
        return true
      }
      set(field, undefined)
      setConflict(result.attempted) // a second conflict replaces the banner
      return false
    } catch (error) {
      const reason = messageOf(error)
      set(field, {
        state: 'error',
        message:
          error instanceof ApiError && error.status !== 0
            ? `Couldn't save the ${label}: ${reason}`
            : reason,
      })
      return false
    }
  }

  function describe(key: keyof TaskPatch, value: unknown): string {
    switch (key) {
      case 'statusId':
        return statusList.find((s) => s.id === value)?.name ?? 'a removed status'
      case 'priority':
        return PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL]
      case 'startDate':
      case 'dueDate':
        return value ? formatDay(String(value)) : 'none'
      case 'tags':
        return (value as string[]).join(', ') || 'none'
      case 'assigneeIds':
        return (
          (value as string[])
            .map((id) => memberList.find((m) => m.id === id)?.name ?? 'a former member')
            .join(', ') || 'none'
        )
      case 'description':
        return value ? '(edited text)' : '(cleared)'
      case 'customFields':
        return Object.entries(value as Record<string, unknown>)
          .map(([id, v]) => {
            const field = customFields.data?.fields?.find((f) => f.id === id)
            return `${field?.name ?? 'a field'}: ${field ? formatValue(field, v) || 'none' : 'changed'}`
          })
          .join('; ')
      default:
        return String(value)
    }
  }

  const changes: ConflictChange[] = conflict
    ? (Object.keys(conflict) as (keyof TaskPatch)[]).map((key) => ({
        field: key,
        label: FIELD_OF[key].label,
        text: describe(key, conflict[key]),
      }))
    : []

  /** A status change that completes a blocked task asks first; Cancel sends nothing (FR-6). */
  async function guardedSave(field: string, label: string, patch: TaskPatch): Promise<boolean> {
    if (patch.statusId) {
      const group = (id: string | undefined) => statusList.find((s) => s.id === id)?.group
      try {
        await guard.confirm(task, completesTask(group(task.statusId), group(patch.statusId)))
      } catch {
        return false
      }
    }
    return save(field, label, patch)
  }

  const common = { task, hints, save: guardedSave }
  const modal = layout === 'modal'
  const fields = (
    <div className="flex flex-col gap-3 p-4">
      {conflict && (
        <ConflictBanner
          changes={changes}
          applying={update.isPending}
          onDiscard={() => setConflict(null)}
          onApply={() => {
            const patch = conflict
            const key = Object.keys(patch)[0] as keyof TaskPatch
            void save(FIELD_OF[key].field, FIELD_OF[key].label.toLowerCase(), patch)
          }}
        />
      )}
      <ParentLink task={task} />
      <TitleField {...common} titleRef={titleRef} />
      <StatusField {...common} statuses={statusList} loading={statuses.isPending} />
      <PriorityField {...common} />
      <div className="grid grid-cols-2 gap-2">
        <DateField {...common} field="startDate" label="Start date" />
        <DateField {...common} field="dueDate" label="Due date" />
      </div>
      <TagsField {...common} />
      <AssigneesField {...common} members={memberList} />
      <DescriptionField {...common} members={memberList} />
      <SubtasksSection task={task} statuses={statusList} />
      <ChecklistsSection taskId={task.id!} workspaceId={task.workspaceId} />
      <CustomFieldsGroup {...common} />
      <DependenciesSection task={task} />
    </div>
  )
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted">{task.readableId}</span>
          {task.blocked && (
            <button
              type="button"
              aria-label="Show dependencies"
              onClick={() =>
                document.getElementById('dependencies')?.scrollIntoView?.({ block: 'nearest' })
              }
              className="rounded"
            >
              <BlockedBadge blocked count={task.blockerCount} showCount />
            </button>
          )}
        </span>
        <span className="flex items-center gap-2">
          <WatchControl taskId={task.id!} />
          <button
            ref={toggleRef}
            type="button"
            aria-pressed={!modal}
            onClick={onToggle}
            className="rounded-md border border-line-strong px-2 py-1 text-xs text-fg hover:bg-surface-2 aria-pressed:bg-accent-soft"
          >
            Docked
          </button>
          <button
            type="button"
            aria-label="Close task panel"
            onClick={onClose}
            className="rounded px-2 text-xl leading-none text-muted hover:bg-surface-2"
          >
            ×
          </button>
        </span>
      </header>
      {modal ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">{fields}</div>
          <div
            role="region"
            aria-label="Discussion and activity"
            className="flex w-[330px] shrink-0 flex-col gap-3 overflow-auto border-l border-line p-4"
          >
            {children?.(task)}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {fields}
          <div className="flex flex-col gap-3 border-t border-line p-4">{children?.(task)}</div>
        </div>
      )}
      {guard.dialog}
    </div>
  )
}

function DescriptionField({
  task,
  hints,
  save,
  members,
}: {
  task: TaskView
  hints: ReturnType<typeof useFieldHints>['hints']
  save: (field: string, label: string, patch: TaskPatch) => Promise<boolean>
  members: { id: string; name: string }[]
}) {
  const pending = useRef<RichDoc | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const server = task.description as RichDoc | null | undefined

  const latest = useRef<() => void>(() => {})
  // Unsaved text is saved when the field goes away (a frame switch, a task switch, a close), never lost.
  useEffect(() => () => latest.current(), [])

  function flush() {
    clearTimeout(timer.current)
    const doc = pending.current
    pending.current = null
    if (!doc) return
    const next = isEmptyDoc(doc) ? null : doc
    if (JSON.stringify(next) === JSON.stringify(isEmptyDoc(server) ? null : server)) return
    void save('description', 'description', { description: next })
  }

  useEffect(() => {
    latest.current = flush
  })

  return (
    <FieldShell label="Description" hint={hints.description}>
      <RichTextEditor
        label="Description"
        value={server}
        members={members}
        onChange={(doc) => {
          pending.current = doc
          clearTimeout(timer.current)
          timer.current = setTimeout(flush, 1000) // saved after 1 s idle or on blur
        }}
        onBlur={(doc) => {
          pending.current = doc
          flush()
        }}
      />
    </FieldShell>
  )
}
