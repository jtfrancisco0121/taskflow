import { tasksOf } from './relations'

/**
 * The Blocked badge (DEP-3, FR-10): text plus an icon, never color alone. Drawn only when the task
 * is blocked; its accessible name is "Blocked by N tasks". With `showCount` the text carries the
 * count (the panel header); `iconOnly` is the Calendar cell form.
 */
export function BlockedBadge({
  blocked,
  count,
  showCount,
  iconOnly,
}: {
  blocked?: boolean
  count?: number
  showCount?: boolean
  iconOnly?: boolean
}) {
  if (!blocked) return null
  const n = Math.max(count ?? 1, 1)
  const name = `Blocked by ${tasksOf(n)}`
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-danger bg-danger-soft px-1 text-xs font-medium text-danger"
    >
      <span aria-hidden="true">⛔</span>
      {!iconOnly && <span aria-hidden="true">{showCount ? `Blocked · ${n}` : 'Blocked'}</span>}
    </span>
  )
}
