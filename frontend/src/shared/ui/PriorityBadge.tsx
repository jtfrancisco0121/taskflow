export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'low'

const flag: Record<PriorityLevel, string> = {
  urgent: 'text-priority-urgent',
  high: 'text-priority-high',
  normal: 'text-priority-normal',
  low: 'text-priority-low',
}

type PriorityBadgeProps = { name: string; level: PriorityLevel }

/** A flag in the priority colour plus the name. */
export function PriorityBadge({ name, level }: PriorityBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={`h-3.5 w-3.5 ${flag[level]}`}
        fill="currentColor"
      >
        <path d="M3 1.5h1.5V3H13l-2 3 2 3H4.5v5.5H3z" />
      </svg>
      {name}
    </span>
  )
}
