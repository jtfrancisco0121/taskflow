import { useState } from 'react'
import { getSessionUser } from '../../api/session'
import { messageOf } from '../../api/errors'
import { Checkbox } from '../../shared/ui/Checkbox'
import { useMembers } from '../workspace'
import {
  useChecklists,
  useChecklistWrites,
  type Checklist,
  type ChecklistItem,
} from './useChecklists'

const inputClass =
  'min-w-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-fg hover:border-line-strong focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-focus-ring'

/**
 * A text field that commits on Enter or blur and gives up its draft on Escape. While it holds a draft Escape stops
 * here, so the task detail stays open; with no draft Escape goes on and closes it.
 */
function DraftInput({
  value,
  label,
  onCommit,
  autoFocus,
  className = '',
}: {
  value: string
  label: string
  onCommit: (text: string) => void
  autoFocus?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text && text !== value) onCommit(text)
  }
  return (
    <input
      aria-label={label}
      value={draft ?? value}
      autoFocus={autoFocus}
      onFocus={autoFocus ? (event) => event.currentTarget.select() : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape' && draft !== null) {
          event.stopPropagation()
          setDraft(null)
        }
      }}
      className={`${inputClass} ${className}`}
    />
  )
}

function ChecklistBlock({
  list,
  names,
  readOnly,
  fresh,
  writes,
}: {
  list: Checklist
  names: Map<string, string>
  readOnly: boolean
  fresh: boolean
  writes: ReturnType<typeof useChecklistWrites>
}) {
  const [text, setText] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const items = list.items ?? []
  const name = list.name ?? ''
  const run = async (result: Promise<string | null>) => setRefusal(await result)
  const done = items.filter((i) => i.checked).length

  return (
    <section aria-label={`Checklist ${name}`} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {readOnly ? (
          <h4 className="flex-1 text-sm font-medium text-fg">{name}</h4>
        ) : (
          <DraftInput
            value={name}
            label="Checklist name"
            autoFocus={fresh}
            className="flex-1 font-medium"
            onCommit={(next) => void run(writes.rename(list, next))}
          />
        )}
        <span className="text-xs text-muted">{`${done}/${items.length}`}</span>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Delete checklist ${name}`}
            onClick={() => void run(writes.remove(list))}
            className="rounded px-1 text-muted hover:bg-surface-2"
          >
            ×
          </button>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item: ChecklistItem) => (
          <li key={item.id} className="flex items-center gap-2">
            <Checkbox
              aria-label={item.text ?? ''}
              checked={!!item.checked}
              disabled={readOnly}
              onCheckedChange={(checked) => void run(writes.editItem(list, item, { checked }))}
            />
            {readOnly ? (
              <span className="flex-1 text-sm text-fg">{item.text}</span>
            ) : (
              <DraftInput
                value={item.text ?? ''}
                label={`Edit item ${item.text}`}
                className="flex-1"
                onCommit={(next) => void run(writes.editItem(list, item, { text: next }))}
              />
            )}
            {item.assigneeId && (
              <span className="text-xs text-muted">
                {names.get(item.assigneeId) ?? 'Former member'}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Delete item ${item.text}`}
                onClick={() => void run(writes.removeItem(list, item))}
                className="rounded px-1 text-muted hover:bg-surface-2"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <input
          aria-label={`Add an item to ${name}`}
          placeholder="Add an item"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const value = text.trim()
              if (!value) return
              setText('')
              void run(writes.addItem(list, value))
            } else if (event.key === 'Escape' && text !== '') {
              event.stopPropagation()
              setText('')
            }
          }}
          className={`${inputClass} border-dashed border-line-strong`}
        />
      )}
      {refusal && (
        <p role="alert" className="text-xs text-danger">
          {refusal}
        </p>
      )}
    </section>
  )
}

/** CAP-8: the task's checklists; a guest sees them read-only. */
export function ChecklistsSection({
  taskId,
  workspaceId,
}: {
  taskId: string
  workspaceId?: string
}) {
  const query = useChecklists(taskId)
  const writes = useChecklistWrites(taskId)
  const { members } = useMembers(workspaceId)
  const me = getSessionUser()?.id
  const readOnly = members.find((m) => m.userId === me)?.role === 'GUEST'
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const [fresh, setFresh] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const lists = query.data ?? []

  return (
    <section aria-label="Checklists" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted">Checklists</h3>
        {!readOnly && (
          <button
            type="button"
            onClick={async () => {
              const { created, message } = await writes.add('Checklist')
              setRefusal(message ?? null)
              setFresh(created?.id ?? null)
            }}
            className="rounded-md border border-line-strong px-2 py-0.5 text-xs text-fg hover:bg-surface-2"
          >
            Add checklist
          </button>
        )}
      </div>
      {query.isPending && (
        <div aria-busy="true" className="h-4 animate-pulse rounded bg-surface-3" />
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load the checklists: {messageOf(query.error)}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.isSuccess && lists.length === 0 && (
        <p className="text-sm text-muted">No checklists yet.</p>
      )}
      {lists.map((list) => (
        <ChecklistBlock
          key={list.id}
          list={list}
          names={names}
          readOnly={readOnly}
          fresh={fresh === list.id}
          writes={writes}
        />
      ))}
      {refusal && (
        <p role="alert" className="text-xs text-danger">
          {refusal}
        </p>
      )}
    </section>
  )
}
