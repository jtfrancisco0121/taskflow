import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Popover } from '../../shared/ui/Popover'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useUserTopic } from '../realtime'
import { inboxPath, notificationSettingsPath } from './routes'
import { notificationText } from './notificationText'
import {
  useInbox,
  useLiveRefreshInbox,
  useMarkAllRead,
  useSetRead,
  useUnreadCount,
} from './useNotifications'

/** The bell in the header: unread count (hidden at 0, "99+"), a popover of the 20 newest (CAP-11). */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const count = useUnreadCount(workspaceId)
  const refresh = useLiveRefreshInbox(workspaceId)
  const [open, setOpen] = useState(false)
  const unread = count.data?.count ?? 0
  const label = unread > 99 ? '99+' : String(unread)

  // Any notification event of this person refreshes the count and every open list; so does a
  // reconnect, since messages may have been missed (AD-18).
  useUserTopic(refresh, refresh)

  // A polite announcement, at most one every 5 seconds.
  const [announcement, setAnnouncement] = useState('')
  const lastAnnounced = useRef({ at: 0, count: 0 })
  useEffect(() => {
    const now = Date.now()
    const last = lastAnnounced.current
    if (unread > last.count && now - last.at >= 5000) {
      lastAnnounced.current = { at: now, count: unread }
      setAnnouncement(`${unread} unread notification${unread === 1 ? '' : 's'}`)
    } else if (unread <= last.count) {
      lastAnnounced.current = { ...last, count: unread }
    }
  }, [unread])

  return (
    <div className="relative">
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Notifications"
        trigger={
          <button
            type="button"
            aria-label={unread > 0 ? `Notifications, ${label} unread` : 'Notifications'}
            className="relative rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-fg hover:bg-surface-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="inline-block h-4 w-4 align-text-bottom"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 11V7a4 4 0 018 0v4l1 1.5H3zM6.5 14a1.5 1.5 0 003 0" />
            </svg>
            {unread > 0 && (
              <span
                data-testid="unread-badge"
                className="ml-1 rounded-full bg-danger px-1.5 py-0.5 text-xs font-semibold text-danger-fg"
              >
                {label}
              </span>
            )}
          </button>
        }
      >
        <NotificationList workspaceId={workspaceId} onClose={() => setOpen(false)} />
      </Popover>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}

function NotificationList({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const inbox = useInbox(workspaceId, false, 20)
  const setRead = useSetRead(workspaceId)
  const markAll = useMarkAllRead(workspaceId)
  const navigate = useNavigate()
  const items = inbox.data?.pages[0]?.items ?? []

  return (
    <div className="w-96">
      <div className="mb-1 flex items-center gap-2 px-1">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <Button
          className="ml-auto"
          disabled={items.length === 0 || markAll.isPending}
          onClick={() => markAll.mutate(items[0]?.id)}
        >
          Mark all read
        </Button>
      </div>
      {inbox.isPending && (
        <div role="status" aria-label="Loading notifications" className="flex flex-col gap-1 p-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {inbox.isError && (
        <ErrorState message="Couldn't load notifications." onRetry={() => void inbox.refetch()} />
      )}
      {inbox.isSuccess && items.length === 0 && (
        <p className="p-2 text-sm text-muted">No notifications yet.</p>
      )}
      <ul className="m-0 max-h-96 list-none overflow-auto p-0">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.read) setRead.mutate({ id: n.id!, read: true })
                onClose()
                void navigate(`/t/${n.taskId}`)
              }}
              className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${n.read ? 'text-muted' : 'font-medium'}`}
            >
              <span>{notificationText(n)}</span>
              <time
                dateTime={n.createdAt}
                title={formatDateTime(n.createdAt)}
                className="text-xs font-normal text-faint"
              >
                {relativeTime(n.createdAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-3 border-t border-line px-1 pt-2 text-sm">
        <Link to={inboxPath(workspaceId)} onClick={onClose} className="text-accent underline">
          Open inbox
        </Link>
        <Link
          to={notificationSettingsPath(workspaceId)}
          onClick={onClose}
          className="ml-auto text-accent underline"
        >
          Settings
        </Link>
      </div>
    </div>
  )
}
