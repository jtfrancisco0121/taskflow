import type { FieldView } from '../../api/types'
import { useMembers } from '../workspace'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** Names of the Workspace's members by user id; an id that is not there is a former member. */
export function usePeopleNames(workspaceId: string | undefined) {
  const { members, isLoading } = useMembers(workspaceId)
  const names = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  return { names, members, isLoading }
}

/** The People value of a task: an avatar per person, "Former member" for a user who left. */
export function PeopleCell({ workspaceId, value }: { workspaceId?: string; value: unknown }) {
  const { names, isLoading } = usePeopleNames(workspaceId)
  const ids = Array.isArray(value) ? (value as string[]) : []
  return (
    <span className="flex flex-wrap items-center gap-1">
      {ids.map((id) => {
        const name = names.get(id)
        if (name === undefined && !isLoading) {
          return (
            <span
              key={id}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-muted"
            >
              Former member
            </span>
          )
        }
        return (
          <span
            key={id}
            title={name ?? ''}
            aria-label={name ?? 'Loading'}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-xs font-medium"
          >
            {initials(name ?? '?')}
          </span>
        )
      })}
    </span>
  )
}

/** The member picker of a People field: one checkbox per member; a former member can be removed. */
export function PeopleEditor({
  workspaceId,
  field,
  value,
  label,
  disabled,
  onCommit,
}: {
  workspaceId?: string
  field: FieldView
  value: unknown
  label: string
  disabled?: boolean
  onCommit: (value: unknown) => void
}) {
  const { names, members } = usePeopleNames(workspaceId)
  const selected = Array.isArray(value) ? (value as string[]) : []
  const former = selected.filter((id) => !names.has(id))
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((s) => s !== id)
    onCommit(next.length === 0 ? null : next)
  }
  return (
    <div
      role="group"
      aria-label={label}
      data-field={field.id}
      className="flex max-h-32 flex-col gap-0.5 overflow-auto rounded border border-line-strong bg-surface p-1"
    >
      {members.map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.includes(m.userId!)}
            onChange={(event) => toggle(m.userId!, event.target.checked)}
          />
          {m.displayName ?? m.email}
        </label>
      ))}
      {former.map((id) => (
        <label key={id} className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked
            disabled={disabled}
            onChange={(event) => toggle(id, event.target.checked)}
          />
          Former member
        </label>
      ))}
    </div>
  )
}
