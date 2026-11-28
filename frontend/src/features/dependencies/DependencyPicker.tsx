import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../../api/client'
import { ApiError, messageOf, unwrap } from '../../api/errors'
import type { DependencyRelation, SearchHit, TaskView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { useAddDependency } from './useDependencies'
import { RELATIONS, RELATION_LABEL } from './relations'
import { hasData, loadFailed } from '../../api/queryState'

const DEBOUNCE_MS = 250
const REF = /^[A-Za-z]{2,6}-\d+$/

type Candidate = { taskId: string; readableId: string; title: string; listName?: string }

/** Names the path of a refused loop: readable ids, and "a task you can't see" for hidden ones. */
async function cycleMessage(path: (string | null)[]): Promise<string> {
  const names = await Promise.all(
    path.map(async (id) => {
      if (!id) return "a task you can't see"
      try {
        const task = await unwrap(api.GET('/api/v1/tasks/{id}', { params: { path: { id } } }))
        return task.readableId ?? "a task you can't see"
      } catch {
        return "a task you can't see"
      }
    }),
  )
  return `This would make a loop: ${names.join(' → ')}.`
}

/** The text a refused add shows under the input (EXPERIENCE.md voice). */
async function refusal(error: unknown): Promise<string> {
  if (!(error instanceof ApiError)) return messageOf(error)
  switch (error.code) {
    case 'dependency.cycle': {
      const path = (error.body as { path?: (string | null)[] } | undefined)?.path
      return path ? cycleMessage(path) : 'This would make the tasks wait on each other.'
    }
    case 'dependency.exists':
      return 'These tasks are already related.'
    case 'dependency.limit':
      return 'A task can have at most 100 relationships.'
    case 'dependency.self':
      return "A task can't be related to itself."
    case 'dependency.busy':
      return 'These tasks are being changed right now. Try again.'
    case 'task.version_conflict':
      return 'This task changed. Try again.'
    case 'task.not_found':
      return "That task can't be found."
    default:
      return messageOf(error)
  }
}

/**
 * The relationship picker (FR-9): a kind control, a combobox that searches the Workspace by words
 * (2+ characters) or looks a readable id up exactly, results without the task itself and tasks
 * already related. A refusal stays in place under the input.
 */
export function DependencyPicker({
  task,
  related,
  onClose,
}: {
  task: TaskView
  related: Set<string>
  onClose: () => void
}) {
  const [relation, setRelation] = useState<DependencyRelation>('WAITING_ON')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const add = useAddDependency(task)
  const workspaceId = task.workspaceId!

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const search = useQuery({
    queryKey: ['ws', workspaceId, 'dependencyPicker', q],
    enabled: q.length >= 2,
    queryFn: async (): Promise<Candidate[]> => {
      const found: Candidate[] = []
      if (REF.test(q)) {
        // A readable id also looks it up exactly and shows it first.
        const { data } = await api.GET('/api/v1/workspaces/{id}/tasks/by-ref/{ref}', {
          params: { path: { id: workspaceId, ref: q.toUpperCase() } },
        })
        if (data?.id) {
          found.push({ taskId: data.id, readableId: data.readableId ?? q, title: data.title ?? '' })
        }
      }
      const page = await unwrap(
        api.GET('/api/v1/workspaces/{id}/search', {
          params: { path: { id: workspaceId }, query: { q, limit: 20 } },
        }),
      )
      for (const hit of (page.items ?? []) as SearchHit[]) {
        if (hit.taskId && !found.some((c) => c.taskId === hit.taskId)) {
          found.push({
            taskId: hit.taskId,
            readableId: hit.readableId ?? '',
            title: hit.title ?? '',
            listName: hit.listName,
          })
        }
      }
      return found
    },
  })
  const results = (search.data ?? []).filter((c) => c.taskId !== task.id && !related.has(c.taskId))
  const shown = q.length >= 2 ? results : []

  async function pick(candidate: Candidate) {
    setMessage(null)
    try {
      await add.mutateAsync({ otherTaskId: candidate.taskId, relation })
      onClose()
    } catch (error) {
      setMessage(await refusal(error))
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter' && shown[active]) {
      event.preventDefault()
      void pick(shown[active])
    }
  }

  return (
    <div
      role="group"
      aria-label="Add a relationship"
      className="flex flex-col gap-2 rounded border border-line bg-surface-2 p-2"
      onKeyDown={onKeyDown}
    >
      <div role="radiogroup" aria-label="Relationship kind" className="flex gap-1 text-sm">
        {RELATIONS.map((r) => (
          <label
            key={r}
            className={`cursor-pointer rounded border px-2 py-0.5 ${relation === r ? 'border-accent bg-accent-soft font-medium' : 'border-line-strong bg-surface'}`}
          >
            <input
              type="radio"
              name={`${listId}-kind`}
              value={r}
              checked={relation === r}
              onChange={() => setRelation(r)}
              className="sr-only"
            />
            {RELATION_LABEL[r]}
          </label>
        ))}
      </div>
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Find a task"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        placeholder="Search by title or id"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
          setMessage(null)
        }}
        className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm focus:outline-2 focus:outline-focus-ring"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching tasks"
        className="m-0 flex max-h-48 list-none flex-col overflow-auto p-0"
      >
        {shown.map((c, i) => (
          <li
            key={c.taskId}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => void pick(c)}
            className={`cursor-pointer rounded px-2 py-1 text-sm ${i === active ? 'bg-accent-soft' : ''}`}
          >
            <span className="font-mono text-xs text-muted">{c.readableId}</span> {c.title}
            {c.listName && <span className="text-xs text-muted"> · {c.listName}</span>}
          </li>
        ))}
      </ul>
      {q.length < 2 && <p className="m-0 text-xs text-muted">Type at least 2 characters.</p>}
      {q.length >= 2 && search.isPending && (
        <p role="status" className="m-0 text-xs text-muted">
          Searching…
        </p>
      )}
      {q.length >= 2 && hasData(search) && shown.length === 0 && (
        <p className="m-0 text-xs text-muted">No tasks match.</p>
      )}
      {loadFailed(search) && (
        <p role="alert" className="m-0 text-xs text-danger">
          {messageOf(search.error)}
        </p>
      )}
      {message && (
        <p role="alert" className="m-0 text-sm text-danger">
          {message}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
