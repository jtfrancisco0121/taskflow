import { Link } from 'react-router'
import { messageOf } from '../../api/errors'
import type { RuleView } from '../../api/types'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { useAutomationRuns } from './useAutomations'

const PILL: Record<string, string> = {
  SUCCEEDED: 'bg-green-100 text-green-800',
  SKIPPED: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-800',
}
const LABEL: Record<string, string> = {
  SUCCEEDED: 'Succeeded',
  SKIPPED: 'Skipped',
  FAILED: 'Failed',
}
const REASON: Record<string, string> = {
  conditions_not_met: 'Conditions not met',
  depth_limit: 'Stopped by the loop limit',
  own_change: "The rule's own change",
  run_guard: 'Too many runs on this task in 10 minutes',
  out_of_scope: 'The task is outside this rule',
  rule_disabled: 'The rule was off',
  no_access: "The rule's creator cannot see this task",
}

/** The run history of one rule, newest first, failed runs expanded (FR-12). */
export function RunsSheet({
  rule,
  onClose,
  restoreFocus,
}: {
  rule: RuleView
  onClose: () => void
  restoreFocus?: () => HTMLElement | null
}) {
  const runs = useAutomationRuns(rule.id)
  const items = runs.data?.pages.flatMap((p) => p.items ?? []) ?? []
  return (
    <Dialog title={`Run history: ${rule.name}`} onClose={onClose} restoreFocus={restoreFocus} wide>
      {runs.isPending && <p role="status">Loading…</p>}
      {runs.isError && (
        <p role="alert" className="text-red-700">
          {messageOf(runs.error)}
        </p>
      )}
      {runs.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-600">No runs yet.</p>
      )}
      <ul className="flex list-none flex-col gap-2 p-0">
        {items.map((run) => (
          <li key={run.id} className="rounded border border-slate-200 p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs ${PILL[run.status ?? ''] ?? ''}`}>
                {LABEL[run.status ?? ''] ?? run.status}
              </span>
              <Link to={`/t/${run.taskId}`} className="text-blue-700 underline">
                {run.taskReadableId} {run.taskTitle}
              </Link>
              <time
                dateTime={run.createdAt}
                title={formatDateTime(run.createdAt)}
                className="ml-auto text-xs text-slate-500"
              >
                {relativeTime(run.createdAt)}
              </time>
            </div>
            <p className="m-0 text-xs text-slate-500">
              Depth {run.depth}
              {run.status === 'SKIPPED' && run.reason
                ? ` · ${REASON[run.reason] ?? run.reason}`
                : ''}
              {run.status === 'FAILED' ? ` · attempt ${run.attempt}` : ''}
            </p>
            {run.status === 'FAILED' && run.error && (
              <p className="m-0 mt-1 rounded bg-red-50 p-1 text-xs text-red-900">{run.error}</p>
            )}
          </li>
        ))}
      </ul>
      {runs.hasNextPage && (
        <div className="mt-2">
          <Button disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </Dialog>
  )
}
