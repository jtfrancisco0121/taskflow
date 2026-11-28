import { Link } from 'react-router'
import { useToastStore } from '../../shared/toast-store'
import { ApiError, messageOf } from '../../api/errors'
import type { AccountActivity } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { changeSentence, linkedTaskId, trashedVersion } from './changeSentence'
import { allPages, useAccountActivity, useAudit, useRestoreTask } from './hooks'
import { RefreshNotice } from '../../shared/ui/RefreshNotice'
import { hasData, loadFailed, refreshFailed } from '../../api/queryState'

function RestoreButton({ workspaceId, entry }: { workspaceId: string; entry: AccountActivity }) {
  const restore = useRestoreTask(workspaceId)
  const show = useToastStore((state) => state.show)
  const version = trashedVersion(entry)
  if (!entry.entityId || version === undefined) return null
  return (
    <Button
      disabled={restore.isPending}
      onClick={() =>
        restore.mutate(
          { taskId: entry.entityId!, version },
          {
            onSuccess: () => show('Task restored'),
            onError: (error) =>
              show(
                error instanceof ApiError && (error.status === 409 || error.status === 404)
                  ? 'This task was already restored, changed or purged.'
                  : messageOf(error),
                'error',
              ),
          },
        )
      }
    >
      Restore
    </Button>
  )
}

function RecentChanges({ workspaceId, accountId }: { workspaceId: string; accountId: string }) {
  const activity = useAccountActivity(workspaceId, accountId)
  const entries = allPages(activity.data)
  return (
    <section aria-labelledby="recent-changes">
      <h2 id="recent-changes" className="mb-2 text-base font-semibold">
        Recent changes
      </h2>
      {activity.isPending && (
        <div role="status" aria-label="Loading changes" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-6 w-full" />
          ))}
        </div>
      )}
      {refreshFailed(activity) && (
        <RefreshNotice
          message={messageOf(activity.error)}
          onRetry={() => void activity.refetch()}
        />
      )}
      {loadFailed(activity) && (
        <ErrorState message={messageOf(activity.error)} onRetry={() => void activity.refetch()} />
      )}
      {hasData(activity) && entries.length === 0 && (
        <EmptyState
          title="No changes yet"
          description="Tasks this account creates or changes appear here."
        />
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {entries.map((entry) => {
          const taskId = linkedTaskId(entry)
          return (
            <li key={entry.id} className="flex items-center gap-2 text-sm">
              <span>
                {taskId ? (
                  <Link to={`/t/${taskId}`} className="text-accent hover:underline">
                    {changeSentence(entry)}
                  </Link>
                ) : (
                  changeSentence(entry)
                )}
                {entry.actorKeyName && (
                  <span className="text-muted"> (key {entry.actorKeyName})</span>
                )}
              </span>
              <time
                dateTime={entry.createdAt}
                className="ml-auto text-xs text-muted"
                title={entry.createdAt}
              >
                {relativeTime(entry.createdAt)}
              </time>
              {entry.type === 'task.trashed' && (
                <RestoreButton workspaceId={workspaceId} entry={entry} />
              )}
            </li>
          )
        })}
      </ul>
      {activity.hasNextPage && (
        <Button
          className="mt-2"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  )
}

/** KEY-6: calls per day for 30 days, the keys' last use, and what the account changed. */
export function AuditTab({ workspaceId, accountId }: { workspaceId: string; accountId: string }) {
  const audit = useAudit(workspaceId, accountId)
  const days = [...(audit.data?.days ?? [])].reverse()
  const max = Math.max(1, ...days.map((day) => day.calls ?? 0))
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="calls-heading">
        <h2 id="calls-heading" className="mb-2 text-base font-semibold">
          Calls in the last 30 days
        </h2>
        {audit.isPending && (
          <div role="status" aria-label="Loading calls" className="flex flex-col gap-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-6 w-full" />
            ))}
          </div>
        )}
        {refreshFailed(audit) && (
          <RefreshNotice message={messageOf(audit.error)} onRetry={() => void audit.refetch()} />
        )}
        {loadFailed(audit) && (
          <ErrorState message={messageOf(audit.error)} onRetry={() => void audit.refetch()} />
        )}
        {hasData(audit) && (audit.data.totalCalls ?? 0) === 0 && (
          <EmptyState
            title="No calls in the last 30 days"
            description="Calls appear here once an agent uses one of this account's keys."
          />
        )}
        {hasData(audit) && (audit.data.totalCalls ?? 0) > 0 && (
          <>
            <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0 text-sm">
              {(audit.data.keys ?? []).map((apiKey) => (
                <li key={apiKey.id}>
                  <span className="font-medium">{apiKey.name}</span>: last used{' '}
                  {apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : 'never'},{' '}
                  {apiKey.calls ?? 0} calls
                </li>
              ))}
            </ul>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Calls per day</caption>
              <tbody>
                {days.map((day) => (
                  <tr key={day.day}>
                    <th scope="row" className="w-28 py-0.5 font-normal text-muted">
                      {formatDay(day.day)}
                    </th>
                    <td className="py-0.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-sm bg-surface-2">
                          <div
                            className="h-2 rounded-sm bg-accent"
                            style={{ width: `${((day.calls ?? 0) / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums">{day.calls ?? 0}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <RecentChanges workspaceId={workspaceId} accountId={accountId} />
    </div>
  )
}
