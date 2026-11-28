import { Button } from './Button'

type RefreshNoticeProps = { message: string; onRetry: () => void }

/**
 * ClickUp 14yq6g334fe: a background refresh failed but the last loaded data is still on screen. A small polite
 * notice above that data, with a Retry; never in place of it (that is ErrorState, for a failed first load).
 */
export function RefreshNotice({ message, onRetry }: RefreshNoticeProps) {
  return (
    <div
      role="status"
      aria-label="Couldn’t refresh"
      className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-[13px] text-muted"
    >
      <span className="flex-1">
        Couldn’t load the latest data. Showing what was already loaded.{' '}
        <span className="sr-only">{message}</span>
      </span>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
