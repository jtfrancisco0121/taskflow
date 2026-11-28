import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { messageOf } from '../../api/errors'
import type { DependencyItem, DependencyList, TaskView } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { getSessionUser } from '../../api/session'
import { useMembers } from '../workspace'
import { DependencyPicker } from './DependencyPicker'
import { useDependencies, useRemoveDependency } from './useDependencies'

type Group = { key: 'waitingOn' | 'blocking' | 'linked'; label: string }

const GROUPS: Group[] = [
  { key: 'waitingOn', label: 'Waiting on' },
  { key: 'blocking', label: 'Blocking' },
  { key: 'linked', label: 'Linked' },
]

const hiddenText = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} you can't see`

/** Unfinished first, then finished, each by readable id. */
function ordered(items: DependencyItem[] | undefined): DependencyItem[] {
  return [...(items ?? [])].sort((a, b) => {
    const fa = a.task?.finished ? 1 : 0
    const fb = b.task?.finished ? 1 : 0
    return (
      fa - fb ||
      (a.task?.readableId ?? '').localeCompare(b.task?.readableId ?? '', 'en', { numeric: true })
    )
  })
}

/**
 * The Dependencies section of the Task panel (FR-9): Waiting on, Blocking and Linked groups, the
 * count of relationships the caller cannot see, an Add button with the picker, and remove without
 * confirmation. A guest sees the rows read-only.
 */
export function DependenciesSection({ task }: { task: TaskView }) {
  const query = useDependencies(task.id)
  const remove = useRemoveDependency(task)
  // One removal at a time: a second one would send the version the first is about to bump, so it
  // would fail as a conflict (ClickUp 14yq6g33592). A ref, so two clicks in one tick see it.
  const removing = useRef(false)
  const [adding, setAdding] = useState(false)
  const location = useLocation()
  const me = getSessionUser()?.id
  const { members } = useMembers(task.workspaceId)
  const role = members.find((m) => m.userId === me)?.role
  const canEdit = role !== 'GUEST'
  const data: DependencyList | undefined = query.data
  const total = data
    ? (data.waitingOn?.length ?? 0) +
      (data.blocking?.length ?? 0) +
      (data.linked?.length ?? 0) +
      (data.hiddenCount?.waitingOn ?? 0) +
      (data.hiddenCount?.blocking ?? 0) +
      (data.hiddenCount?.linked ?? 0)
    : 0
  const related = new Set(
    GROUPS.flatMap((g) => data?.[g.key] ?? []).flatMap((i) => (i.task?.id ? [i.task.id] : [])),
  )

  return (
    <section id="dependencies" aria-label="Dependencies" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Dependencies</h3>
        {canEdit && !adding && (
          <Button onClick={() => setAdding(true)} aria-label="Add a relationship">
            Add
          </Button>
        )}
      </div>
      {adding && canEdit && (
        <DependencyPicker task={task} related={related} onClose={() => setAdding(false)} />
      )}
      {query.isPending && (
        <div aria-busy="true" className="flex animate-pulse flex-col gap-2">
          <div className="h-4 rounded bg-surface-3" />
          <div className="h-4 rounded bg-surface-3" />
        </div>
      )}
      {query.isError && (
        <div role="alert" className="text-sm text-danger">
          <p className="m-0">Couldn&apos;t load dependencies.</p>
          <span className="sr-only">{messageOf(query.error)}</span>
          <Button className="mt-1" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {data && total === 0 && !adding && (
        <p className="m-0 text-sm text-muted">No dependencies yet.</p>
      )}
      {data &&
        GROUPS.map((group) => {
          const items = ordered(data[group.key])
          const hidden = data.hiddenCount?.[group.key] ?? 0
          if (items.length === 0 && hidden === 0) return null
          return (
            <div key={group.key}>
              <h4 className="m-0 mb-1 text-xs font-semibold text-muted">
                {group.label} ({items.length + hidden})
              </h4>
              <ul aria-label={group.label} className="m-0 flex list-none flex-col gap-1 p-0">
                {items.map((item) => (
                  <li
                    key={item.dependencyId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      to={`/t/${item.task?.id}`}
                      state={location.state}
                      replace
                      className={`min-w-0 truncate hover:underline ${item.task?.finished ? 'text-muted line-through' : ''}`}
                    >
                      <span className="font-mono text-xs">{item.task?.readableId}</span>{' '}
                      {item.task?.title}
                    </Link>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove relationship with ${item.task?.readableId}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (removing.current) return
                          removing.current = true
                          remove.mutate(
                            { dependencyId: item.dependencyId!, otherTaskId: item.task!.id! },
                            {
                              onSettled: () => {
                                removing.current = false
                              },
                            },
                          )
                        }}
                        className="rounded px-1 text-muted hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
                {hidden > 0 && <li className="text-sm text-muted">{hiddenText(hidden)}</li>}
              </ul>
            </div>
          )
        })}
    </section>
  )
}
