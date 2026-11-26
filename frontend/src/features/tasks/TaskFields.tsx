import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import type { StatusInfo, TaskView } from '../../api/types'
import { toInputDay } from '../../shared/dates'
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
} from './editorItems'
import { FieldShell, type Hint } from './FieldShell'
import type { TaskPatch } from './useUpdateTask'

type Save = (field: string, label: string, patch: TaskPatch) => Promise<boolean>

type CommonProps = {
  task: TaskView
  hints: Record<string, Hint | undefined>
  save: Save
}

const inputClass =
  'rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg focus:outline-2 focus:outline-focus-ring'
const triggerClass =
  'inline-flex h-8 w-full items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus-ring'

/** A Picker field: the trigger is named by the field's label and shows the current value (AD-3). */
function PickerTrigger({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  // The popover passes its open/close props through `rest`.
  return (
    <button {...rest} type="button" aria-label={label} className={triggerClass}>
      {children}
    </button>
  )
}

export function TitleField({
  task,
  hints,
  save,
  titleRef,
}: CommonProps & { titleRef: React.Ref<HTMLInputElement> }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? task.title ?? ''

  async function commit() {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next === (task.title ?? '') || next === '') return // empty titles are not sent
    await save('title', 'title', { title: next })
  }

  return (
    <FieldShell label="Title" htmlFor={id} hint={hints.title}>
      <input
        id={id}
        ref={titleRef}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          } else if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation()
            setDraft(null)
          }
        }}
        className={`${inputClass} text-lg font-semibold`}
      />
    </FieldShell>
  )
}

export function StatusField({
  task,
  hints,
  save,
  statuses,
  loading,
}: CommonProps & { statuses: StatusInfo[]; loading?: boolean }) {
  const current = statuses.find((s) => s.id === task.statusId)
  return (
    <FieldShell label="Status" hint={hints.status}>
      <Picker
        mode="single"
        label="Set status"
        loading={loading ? 'Loading…' : undefined}
        trigger={
          <PickerTrigger label="Status">
            <StatusValue status={current} />
          </PickerTrigger>
        }
        items={statusItems(statuses)}
        selected={task.statusId ? [task.statusId] : []}
        onPick={(statusId) => {
          if (statusId !== task.statusId) void save('status', 'status', { statusId })
        }}
      />
    </FieldShell>
  )
}

export function PriorityField({ task, hints, save }: CommonProps) {
  const priority = task.priority ?? 'NONE'
  return (
    <FieldShell label="Priority" hint={hints.priority}>
      <Picker
        mode="single"
        label="Set priority"
        trigger={
          <PickerTrigger label="Priority">
            <PriorityValue priority={priority} />
          </PickerTrigger>
        }
        items={priorityItems()}
        selected={[priority]}
        onPick={(next) => {
          if (next !== priority)
            void save('priority', 'priority', {
              priority: next as NonNullable<TaskPatch['priority']>,
            })
        }}
      />
    </FieldShell>
  )
}

export function DateField({
  task,
  hints,
  save,
  field,
  label,
}: CommonProps & { field: 'startDate' | 'dueDate'; label: string }) {
  const [open, setOpen] = useState(false)
  const days = quickDays()
  const send = (day: string | null) => {
    setOpen(false)
    void save(field, label.toLowerCase(), { [field]: day })
  }
  return (
    <FieldShell label={label} hint={hints[field]}>
      <Picker
        mode="single"
        label={`Set ${label.toLowerCase()}`}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <PickerTrigger label={label}>
            <DayValue iso={task[field]} />
          </PickerTrigger>
        }
        items={dayItems(days)}
        selected={[]}
        onPick={(value) => send(dayOfItem(value, days))}
        footer={
          <input
            type="date"
            aria-label={`${label} day`}
            value={toInputDay(task[field])}
            className={`${inputClass} w-full`}
            onChange={(event) => {
              const day = event.target.value
              if (day) send(`${day}T00:00:00Z`)
            }}
          />
        }
      />
    </FieldShell>
  )
}

export function TagsField({ task, hints, save }: CommonProps) {
  const id = useId()
  const [text, setText] = useState('')
  const tags = task.tags ?? []

  return (
    <FieldShell label="Tags" htmlFor={id} hint={hints.tags}>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface p-1">
        {tags.map((tag) => (
          <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-fg">
            {tag}
          </span>
        ))}
        <input
          id={id}
          value={text}
          placeholder="Add a tag"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const tag = text.trim()
              if (tag && !tags.includes(tag)) void save('tags', 'tags', { tags: [...tags, tag] })
              setText('')
            } else if (event.key === 'Backspace' && text === '' && tags.length > 0) {
              void save('tags', 'tags', { tags: tags.slice(0, -1) })
            } else if (event.key === 'Escape' && text !== '') {
              event.stopPropagation()
              setText('')
            }
          }}
          className="min-w-20 flex-1 bg-transparent px-1 py-0.5 text-sm text-fg outline-none"
        />
      </div>
    </FieldShell>
  )
}

export function AssigneesField({
  task,
  hints,
  save,
  members,
}: CommonProps & { members: { id: string; name: string }[] }) {
  const assignees = task.assigneeIds ?? []
  // Several toggles can follow one another before the first save returns, so each one builds on the selection
  // the previous one produced, never on the task as it was rendered.
  const pending = useRef(assignees)
  const latest = useRef(assignees)
  const inFlight = useRef(0)
  useEffect(() => {
    latest.current = assignees
    if (inFlight.current === 0) pending.current = assignees
  })
  const names = new Map(members.map((m) => [m.id, m.name]))

  function toggle(userId: string) {
    const next = pending.current.includes(userId)
      ? pending.current.filter((id) => id !== userId)
      : [...pending.current, userId]
    pending.current = next
    inFlight.current += 1
    void save('assignees', 'assignees', { assigneeIds: next }).finally(() => {
      inFlight.current -= 1
      if (inFlight.current === 0) setTimeout(() => (pending.current = latest.current), 0)
    })
  }

  return (
    <FieldShell label="Assignees" hint={hints.assignees}>
      <Picker
        mode="multi"
        label="Set assignees"
        trigger={
          <PickerTrigger label="Assignees">
            <AssigneesValue ids={assignees} names={names} />
          </PickerTrigger>
        }
        items={assigneeItems(members.map((m) => ({ userId: m.id, displayName: m.name })))}
        selected={assignees}
        onPick={toggle}
      />
    </FieldShell>
  )
}
