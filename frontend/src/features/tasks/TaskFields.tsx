import { useId, useState } from 'react'
import { formatDay, toApiDate, toInputDay } from '../../shared/dates'
import { StatusPill } from '../../shared/ui/StatusPill'
import type { StatusInfo, TaskView } from '../../api/types'
import { FieldShell, type Hint } from './FieldShell'
import { PRIORITIES, PRIORITY_LABEL } from './labels'
import type { TaskPatch } from './useUpdateTask'

type Save = (field: string, label: string, patch: TaskPatch) => Promise<boolean>

type CommonProps = {
  task: TaskView
  hints: Record<string, Hint | undefined>
  save: Save
}

const inputClass =
  'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-blue-600'

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
  const id = useId()
  const current = statuses.find((s) => s.id === task.statusId)
  return (
    <FieldShell label="Status" htmlFor={id} hint={hints.status}>
      <div className="flex items-center gap-2">
        {current && <StatusPill name={current.name ?? ''} color={current.color} />}
        <select
          id={id}
          value={task.statusId ?? ''}
          onChange={(event) => void save('status', 'status', { statusId: event.target.value })}
          className={`${inputClass} flex-1`}
        >
          {!current && (
            <option value={task.statusId ?? ''}>{loading ? 'Loading…' : 'Unknown status'}</option>
          )}
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>
    </FieldShell>
  )
}

export function PriorityField({ task, hints, save }: CommonProps) {
  const id = useId()
  return (
    <FieldShell label="Priority" htmlFor={id} hint={hints.priority}>
      <select
        id={id}
        value={task.priority ?? 'NONE'}
        onChange={(event) =>
          void save('priority', 'priority', {
            priority: event.target.value as NonNullable<TaskPatch['priority']>,
          })
        }
        className={inputClass}
      >
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITY_LABEL[priority] === '—' ? 'None' : PRIORITY_LABEL[priority]}
          </option>
        ))}
      </select>
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
  const id = useId()
  const server = toInputDay(task[field])
  return (
    <FieldShell label={label} htmlFor={id} hint={hints[field]}>
      <input
        id={id}
        type="date"
        value={server}
        title={server ? formatDay(task[field]) : undefined}
        onChange={(event) => {
          const day = event.target.value
          void save(field, label.toLowerCase(), { [field]: day ? toApiDate(day) : null })
        }}
        className={inputClass}
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
      <div className="flex flex-wrap items-center gap-1 rounded border border-slate-300 bg-white p-1">
        {tags.map((tag) => (
          <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
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
            }
          }}
          className="min-w-20 flex-1 px-1 py-0.5 text-sm outline-none"
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
  const selected = task.assigneeIds ?? []
  return (
    <fieldset className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <legend className="text-xs font-medium text-slate-600">Assignees</legend>
        <span aria-live="polite" className="text-xs text-slate-500">
          {hints.assignees?.state === 'saving'
            ? 'Saving…'
            : hints.assignees?.state === 'saved'
              ? 'Saved'
              : ''}
        </span>
      </div>
      <div className="flex max-h-28 flex-col gap-0.5 overflow-auto rounded border border-slate-300 bg-white p-1">
        {members.map((member) => (
          <label key={member.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(member.id)}
              onChange={(event) =>
                void save('assignees', 'assignees', {
                  assigneeIds: event.target.checked
                    ? [...selected, member.id]
                    : selected.filter((id) => id !== member.id),
                })
              }
            />
            {member.name}
          </label>
        ))}
      </div>
      {hints.assignees?.state === 'error' && (
        <p role="alert" className="text-xs text-red-700">
          {hints.assignees.message}
        </p>
      )}
    </fieldset>
  )
}
