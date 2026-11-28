import { useEffect, useRef } from 'react'
import type { StatusInfo, TaskView } from '../../api/types'
import { toApiDate, toInputDay } from '../../shared/dates'
import { Picker } from '../../shared/ui/Picker'
import {
  AssigneesValue,
  DayValue,
  PriorityValue,
  StatusValue,
  assigneeItems,
  dayItems,
  dayOfItem,
  priorityItems,
  quickDays,
  statusItems,
  type Member,
} from '../tasks'
import { useGuardedStatus } from './useGuardedStatus'
import { useTaskActions } from './useTaskActions'
import { useViewStore, type EditorField } from './viewStore'

const trigger =
  'inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-transparent px-1 text-[13px] text-fg hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus-ring'

/**
 * Whether this row's editor of `field` is the open one, and how to open or close it (click and keys alike).
 *
 * Closing hands focus back to the trigger at once, inside the row, so the next row key (s, p, a, d, j, k) works.
 * Radix only returns focus in a timer after the popover has unmounted; a key pressed in that gap fell on the body
 * and was lost (list.spec "row keys" flake). Focus that already moved elsewhere (a click outside, a confirmation
 * Dialog) is left alone, and Radix's own late return then sees it on the trigger and does nothing (keepFocusIfMoved).
 */
function useEditorOpen(taskId: string, field: EditorField) {
  const open = useViewStore((s) => s.openEditor?.taskId === taskId && s.openEditor.field === field)
  const set = useViewStore((s) => s.setOpenEditor)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return {
    triggerRef,
    editor: {
      open,
      onOpenChange: (next: boolean) => {
        if (!next) handFocusBack(triggerRef.current)
        set(next ? { taskId, field } : null)
      },
    },
  }
}

/** Focuses `trigger` when focus is in a floating layer (the closing editor) or fell to the body. */
function handFocusBack(trigger: HTMLElement | null) {
  const active = document.activeElement
  const lost = !active || active === document.body || active.closest('[data-tf-floating]') !== null
  if (trigger?.isConnected && lost) trigger.focus()
}

export function StatusEditor({ task, statuses }: { task: TaskView; statuses: StatusInfo[] }) {
  const guarded = useGuardedStatus()
  const { editor, triggerRef } = useEditorOpen(task.id!, 'status')
  const current = statuses.find((s) => s.id === task.statusId)
  return (
    <>
      <Picker
        mode="single"
        label={`Set status of ${task.readableId}`}
        {...editor}
        trigger={
          <button
            ref={triggerRef}
            type="button"
            aria-label={`Status of ${task.readableId}`}
            className={trigger}
            onClick={(e) => e.stopPropagation()}
          >
            <StatusValue status={current} />
          </button>
        }
        items={statusItems(statuses)}
        selected={task.statusId ? [task.statusId] : []}
        onPick={(statusId) => {
          if (statusId !== task.statusId) void guarded.change(task, statusId, statuses)
        }}
      />
      {guarded.dialog}
    </>
  )
}

export function PriorityEditor({ task }: { task: TaskView }) {
  const actions = useTaskActions()
  const { editor, triggerRef } = useEditorOpen(task.id!, 'priority')
  const priority = task.priority ?? 'NONE'
  return (
    <Picker
      mode="single"
      label={`Set priority of ${task.readableId}`}
      {...editor}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Priority of ${task.readableId}`}
          className={trigger}
          onClick={(e) => e.stopPropagation()}
        >
          <PriorityValue priority={priority} />
        </button>
      }
      items={priorityItems()}
      selected={[priority]}
      onPick={(next) => {
        if (next !== priority) void actions.patch(task, { priority: next as TaskView['priority'] })
      }}
    />
  )
}

/**
 * The assignee editor stays open after a pick, so several toggles can be queued behind one another. A queued job
 * builds its optimistic patch only when it starts, so the editor keeps its own pending selection: seeded from the
 * task when the editor opens, updated on each toggle, and sent in full. A toggle never works from the stale cache.
 */
export function AssigneeEditor({
  task,
  members,
  names,
}: {
  task: TaskView
  members: Member[]
  names: Map<string, string>
}) {
  const actions = useTaskActions()
  const { editor, triggerRef } = useEditorOpen(task.id!, 'assignee')
  const assignees = task.assigneeIds ?? []
  const pending = useRef<string[]>(assignees)
  const latest = useRef<string[]>(assignees)
  const inFlight = useRef(0)
  useEffect(() => {
    latest.current = assignees
  })
  useEffect(() => {
    if (editor.open && inFlight.current === 0) pending.current = latest.current
  }, [editor.open])

  function toggle(userId: string) {
    const selected = pending.current
    const next = selected.includes(userId)
      ? selected.filter((id) => id !== userId)
      : [...selected, userId]
    pending.current = next
    inFlight.current += 1
    void actions.patch(task, { assigneeIds: next }).finally(() => {
      inFlight.current -= 1
      // Settled (saved, or reverted after a 409): trust the cache again once it has rendered.
      if (inFlight.current === 0) setTimeout(() => (pending.current = latest.current), 0)
    })
  }

  return (
    <Picker
      mode="multi"
      label={`Set assignees of ${task.readableId}`}
      {...editor}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Assignees of ${task.readableId}`}
          className={trigger}
          onClick={(e) => e.stopPropagation()}
        >
          <AssigneesValue ids={assignees} names={names} />
        </button>
      }
      items={assigneeItems(members)}
      selected={assignees}
      onPick={toggle}
    />
  )
}

export function DueEditor({ task, done }: { task: TaskView; done: boolean }) {
  return <DayEditor task={task} field="dueDate" done={done} />
}

export function StartEditor({ task }: { task: TaskView }) {
  return <DayEditor task={task} field="startDate" done={false} />
}

const DAY_FIELD = {
  dueDate: { editor: 'due', word: 'due', Word: 'Due' },
  startDate: { editor: 'start', word: 'start', Word: 'Start' },
} as const

/** One day editor for the due and the start date; only the due date can be overdue. */
function DayEditor({
  task,
  field,
  done,
}: {
  task: TaskView
  field: 'dueDate' | 'startDate'
  done: boolean
}) {
  const actions = useTaskActions()
  const { editor: key, word, Word } = DAY_FIELD[field]
  const { editor, triggerRef } = useEditorOpen(task.id!, key)
  const days = quickDays()
  const day = toInputDay(task[field])
  const overdue = field === 'dueDate' && !!day && day < days.today && !done
  const save = (value: string | null) => {
    editor.onOpenChange(false)
    void actions.patch(task, { [field]: value as string })
  }
  return (
    <Picker
      mode="single"
      label={`Set ${word} date of ${task.readableId}`}
      {...editor}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${Word} date of ${task.readableId}`}
          aria-describedby={overdue ? `overdue-${task.id}` : undefined}
          className={`${trigger} ${overdue ? 'text-danger' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <DayValue iso={task[field]} />
          {overdue && (
            <span id={`overdue-${task.id}`} className="sr-only">
              overdue
            </span>
          )}
        </button>
      }
      items={dayItems(days)}
      selected={[]}
      onPick={(value) => save(dayOfItem(value, days))}
      footer={
        <input
          type="date"
          aria-label={`${Word} day of ${task.readableId}`}
          value={day}
          className="h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg"
          onChange={(e) => e.target.value && save(toApiDate(e.target.value))}
        />
      }
    />
  )
}
