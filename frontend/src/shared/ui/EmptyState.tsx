import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  description?: string
  /** An optional action, for example a primary Button. */
  action?: ReactNode
}

/** Nothing here yet: a title, one sentence and an optional action. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-8 w-8 text-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="M3.5 10h17" />
      </svg>
      <h3 className="font-display text-base font-semibold text-fg">{title}</h3>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {action}
    </div>
  )
}
