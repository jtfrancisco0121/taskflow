export type StatusTone = 'todo' | 'progress' | 'review' | 'done'

const dot: Record<StatusTone, string> = {
  todo: 'bg-status-todo',
  progress: 'bg-status-progress',
  review: 'bg-status-review',
  done: 'bg-status-done',
}

type StatusBadgeProps = { name: string; tone?: StatusTone }

/** A status pill: a dot in the tone colour plus the name. The name carries the meaning, never the colour alone. */
export function StatusBadge({ name, tone = 'todo' }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot[tone]}`} />
      {name}
    </span>
  )
}
