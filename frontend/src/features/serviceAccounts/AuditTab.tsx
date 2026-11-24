import { Link } from 'react-router'
import { useToastStore } from '../../shared/toast-store'
import { ApiError, messageOf } from '../../api/errors'
import type { AccountActivity } from '../../api/types'
import { formatDay, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { changeSentence, linkedTaskId, trashedVersion } from './changeSentence'
import { allPages, useAccountActivity, useAudit, useRestoreTask } from './hooks'

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
      {activity.isPending && <p role="status">Loading…</p>}
      {activity.isError && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="mb-2 text-red-900">{messageOf(activity.error)}</p>
          <Button onClick={() => void activity.refetch()}>Retry</Button>
        </div>
      )}
      {activity.isSuccess && entries.length === 0 && (
        <p className="text-sm text-slate-600">No changes yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {entries.map((entry) => {
          const taskId = linkedTaskId(entry)
          return (
            <li key={entry.id} className="flex items-center gap-2 text-sm">
              <span>
                {taskId ? (
                  <Link to={`/t/${taskId}`} className="text-blue-700 hover:underline">
                    {changeSentence(entry)}
                  </Link>
                ) : (
                  changeSentence(entry)
                )}
                {entry.actorKeyName && (
                  <span className="text-slate-500"> (key {entry.actorKeyName})</span>
                )}
              </span>
              <time
                dateTime={entry.createdAt}
                className="ml-auto text-xs text-slate-500"
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
        {audit.isPending && <p role="status">Loading…</p>}
        {audit.isError && (
          <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
            <p className="mb-2 text-red-900">{messageOf(audit.error)}</p>
            <Button onClick={() => void audit.refetch()}>Retry</Button>
          </div>
        )}
        {audit.isSuccess && (audit.data.totalCalls ?? 0) === 0 && (
          <p className="text-sm text-slate-600">No calls in the last 30 days.</p>
        )}
        {audit.isSuccess && (audit.data.totalCalls ?? 0) > 0 && (
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
                    <th scope="row" className="w-28 py-0.5 font-normal text-slate-600">
                      {formatDay(day.day)}
                    </th>
                    <td className="py-0.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded bg-slate-100">
                          <div
                            className="h-2 rounded bg-blue-600"
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
