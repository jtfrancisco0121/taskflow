import { Button } from './Button'

type ErrorStateProps = { message: string; onRetry?: () => void }

/** A failed load: the message in a danger banner and a Retry button. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-danger bg-danger-soft p-3 text-[13px] text-fg"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-4 w-4 shrink-0 text-danger"
        fill="currentColor"
      >
        <path d="M8 1.5l7 12.5H1zM7.3 6h1.4v4H7.3zm0 5h1.4v1.4H7.3z" />
      </svg>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
