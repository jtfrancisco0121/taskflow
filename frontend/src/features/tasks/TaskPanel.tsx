import { useEffect, useRef, useState } from 'react'
import { ApiError, messageOf } from '../../api/errors'
import type { StatusInfo, TaskView } from '../../api/types'
import { formatDay } from '../../shared/dates'
import { RichTextEditor, isEmptyDoc, type RichDoc } from '../../shared/richtext'
import { Button } from '../../shared/ui/Button'
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
import { useTask } from './useTask'
import { useUpdateTask, type TaskPatch } from './useUpdateTask'

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
  children?: (task: TaskView) => React.ReactNode
}

export function TaskPanel({ taskId, onClose, children }: TaskPanelProps) {
  const query = useTask(taskId)
  const task = query.data

  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    // Return focus to where the user came from (the row), also after the opener re-rendered.
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus()
      } else {
        document.querySelector<HTMLElement>(`[data-task-id="${taskId}"] a`)?.focus()
      }
    }
  }, [taskId])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.closest('[contenteditable="true"]')) return // an editor is open
    event.stopPropagation()
    onClose()
  }

  if (query.isError || (query.isSuccess && !task)) {
    const status = query.error instanceof ApiError ? query.error.status : 0
    return (
      <aside
        role="complementary"
        aria-label="Task"
        className="w-96 shrink-0 border-l border-line bg-surface p-4"
        onKeyDown={onKeyDown}
      >
        <p>{status === 403 || status === 404 ? 'Task not found.' : messageOf(query.error)}</p>
        <Button className="mt-3" onClick={onClose}>
          Close
        </Button>
      </aside>
    )
  }
  if (!task) {
    return (
      <aside
        role="complementary"
        aria-label="Task"
        aria-busy="true"
        className="w-96 shrink-0 border-l border-line bg-surface p-4"
      >
        <div className="flex animate-pulse flex-col gap-3">
          <div className="h-6 rounded bg-surface-3" />
          <div className="h-4 rounded bg-surface-3" />
          <div className="h-4 rounded bg-surface-3" />
        </div>
      </aside>
    )
  }
  return (
    <TaskPanelBody
      key={task.id}
      task={task}
      panelRef={panelRef}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      {children}
    </TaskPanelBody>
  )
}

type BodyProps = {
  task: TaskView
  panelRef: React.Ref<HTMLElement>
  onClose: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
  children?: (task: TaskView) => React.ReactNode
}

function TaskPanelBody({ task, panelRef, onClose, onKeyDown, children }: BodyProps) {
  const update = useUpdateTask(task.id!)
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const statusList: StatusInfo[] = statuses.data?.statuses ?? []
  const { members } = useMembers(task.workspaceId)
  const memberList = members.map((m) => ({ id: m.userId!, name: m.displayName ?? m.email ?? '' }))
  const customFields = useLocationFields(task.listId)
  const { hints, set } = useFieldHints()
  const guard = useCompletionGuard()
  const [conflict, setConflict] = useState<TaskPatch | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
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
  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={`Task ${task.readableId}`}
      onKeyDown={onKeyDown}
      className="flex h-full max-h-full w-96 shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface p-4"
    >
      <header className="flex items-center justify-between">
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
            type="button"
            aria-label="Close task panel"
            onClick={onClose}
            className="rounded px-2 text-xl leading-none hover:bg-surface-2"
          >
            ×
          </button>
        </span>
      </header>
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
      <CustomFieldsGroup {...common} />
      <DependenciesSection task={task} />
      {children?.(task)}
      {guard.dialog}
    </aside>
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

  useEffect(() => () => clearTimeout(timer.current), [])

  function flush() {
    clearTimeout(timer.current)
    const doc = pending.current
    pending.current = null
    if (!doc) return
    const next = isEmptyDoc(doc) ? null : doc
    if (JSON.stringify(next) === JSON.stringify(isEmptyDoc(server) ? null : server)) return
    void save('description', 'description', { description: next })
  }

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
