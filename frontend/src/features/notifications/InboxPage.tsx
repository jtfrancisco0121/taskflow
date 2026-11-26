import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { notificationText } from './notificationText'
import { useInbox, useMarkAllRead, useSetRead } from './useNotifications'

/** `/w/:ws/inbox`: Unread and All tabs, cursor paging, mark read or unread (CAP-11). */
export function InboxPage() {
  const { workspaceId = '' } = useParams()
  const [tab, setTab] = useState<'unread' | 'all'>('unread')
  const inbox = useInbox(workspaceId, tab === 'unread', 30)
  const setRead = useSetRead(workspaceId)
  const markAll = useMarkAllRead(workspaceId)
  const items = inbox.data?.pages.flatMap((p) => p.items ?? []) ?? []

  return (
    <section aria-label="Inbox">
      <PageHeader title="Inbox">
        <Button disabled={markAll.isPending} onClick={() => markAll.mutate(undefined)}>
          Mark all read
        </Button>
      </PageHeader>
      <div role="tablist" aria-label="Inbox filter" className="mb-3 flex gap-2">
        {(['unread', 'all'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md border px-3 py-1 text-[13px] font-medium transition-colors duration-(--tf-dur-fast) ${tab === t ? 'border-transparent bg-linear-to-br from-primary-from to-primary-to text-primary-fg' : 'border-line-strong bg-surface text-fg hover:bg-surface-2'}`}
          >
            {t === 'unread' ? 'Unread' : 'All'}
          </button>
        ))}
      </div>
      {inbox.isPending && (
        <div role="status" aria-label="Loading the inbox" className="flex flex-col gap-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {inbox.isError && (
        <ErrorState message={messageOf(inbox.error)} onRetry={() => void inbox.refetch()} />
      )}
      {inbox.isSuccess && items.length === 0 && (
        <EmptyState
          title={tab === 'unread' ? "You're all caught up." : 'No notifications yet.'}
          description={
            tab === 'unread'
              ? 'New mentions, assignments and comments show up here.'
              : 'Activity on tasks you follow shows up here.'
          }
        />
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]"
          >
            {!n.read && (
              <span
                role="img"
                aria-label="Unread"
                className="h-2 w-2 shrink-0 rounded-full bg-accent"
              />
            )}
            <Link
              to={`/t/${n.taskId}`}
              onClick={() => {
                if (!n.read) setRead.mutate({ id: n.id!, read: true })
              }}
              className={`flex-1 hover:underline ${n.read ? 'text-muted' : 'font-medium text-fg'}`}
            >
              {notificationText(n)}
            </Link>
            <time
              dateTime={n.createdAt}
              title={formatDateTime(n.createdAt)}
              className="text-xs text-faint"
            >
              {relativeTime(n.createdAt)}
            </time>
            <Button onClick={() => setRead.mutate({ id: n.id!, read: !n.read })}>
              {n.read ? 'Mark unread' : 'Mark read'}
            </Button>
          </li>
        ))}
      </ul>
      {inbox.hasNextPage && (
        <div className="mt-3">
          <Button disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </section>
  )
}
