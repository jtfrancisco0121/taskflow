import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { Button } from '../../shared/ui/Button'
import { useUserTopic } from '../realtime'
import { notificationText } from './notificationText'
import {
  useInbox,
  useMarkAllRead,
  useRefreshInbox,
  useSetRead,
  useUnreadCount,
} from './useNotifications'

/** The bell in the header: unread count (hidden at 0, "99+"), a popover of the 20 newest (CAP-11). */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const count = useUnreadCount(workspaceId)
  const refresh = useRefreshInbox(workspaceId)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
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
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${label} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span
            data-testid="unread-badge"
            className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white"
          >
            {label}
          </span>
        )}
      </button>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {open && (
        <Popover
          workspaceId={workspaceId}
          onClose={() => {
            setOpen(false)
            button.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function Popover({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const inbox = useInbox(workspaceId, false, 20)
  const setRead = useSetRead(workspaceId)
  const markAll = useMarkAllRead(workspaceId)
  const navigate = useNavigate()
  const items = inbox.data?.pages[0]?.items ?? []

  // Escape closes the popover from wherever focus is, and the bell gets focus back.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 z-30 mt-1 w-96 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
    >
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
        <p role="status" className="p-2 text-sm">
          Loading…
        </p>
      )}
      {inbox.isError && (
        <p role="alert" className="p-2 text-sm text-red-700">
          Couldn&apos;t load notifications.
        </p>
      )}
      {inbox.isSuccess && items.length === 0 && (
        <p className="p-2 text-sm text-slate-600">No notifications yet.</p>
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
              className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${n.read ? 'text-slate-600' : 'font-medium'}`}
            >
              <span>{notificationText(n)}</span>
              <time
                dateTime={n.createdAt}
                title={formatDateTime(n.createdAt)}
                className="text-xs font-normal text-slate-500"
              >
                {relativeTime(n.createdAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-3 border-t border-slate-200 px-1 pt-2 text-sm">
        <Link to={`/w/${workspaceId}/inbox`} onClick={onClose} className="text-blue-700 underline">
          Open inbox
        </Link>
        <Link
          to={`/w/${workspaceId}/settings/notifications`}
          onClick={onClose}
          className="ml-auto text-blue-700 underline"
        >
          Settings
        </Link>
      </div>
    </div>
  )
}
