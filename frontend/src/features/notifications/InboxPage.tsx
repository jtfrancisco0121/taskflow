import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
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
      <header className="mb-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <Button
          className="ml-auto"
          disabled={markAll.isPending}
          onClick={() => markAll.mutate(undefined)}
        >
          Mark all read
        </Button>
      </header>
      <div role="tablist" aria-label="Inbox filter" className="mb-3 flex gap-2">
        {(['unread', 'all'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white hover:bg-slate-100'}`}
          >
            {t === 'unread' ? 'Unread' : 'All'}
          </button>
        ))}
      </div>
      {inbox.isPending && <p role="status">Loading…</p>}
      {inbox.isError && (
        <p role="alert" className="text-red-700">
          {messageOf(inbox.error)}
        </p>
      )}
      {inbox.isSuccess && items.length === 0 && (
        <p className="text-slate-600">
          {tab === 'unread' ? "You're all caught up." : 'No notifications yet.'}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <Link
              to={`/t/${n.taskId}`}
              onClick={() => {
                if (!n.read) setRead.mutate({ id: n.id!, read: true })
              }}
              className={`flex-1 hover:underline ${n.read ? 'text-slate-600' : 'font-medium'}`}
            >
              {notificationText(n)}
            </Link>
            <time
              dateTime={n.createdAt}
              title={formatDateTime(n.createdAt)}
              className="text-xs text-slate-500"
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
