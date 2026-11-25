import { NavLink } from 'react-router'
import { inboxPath } from './routes'
import { useUnreadCount } from './useNotifications'

/** The sidebar's Inbox entry: a badge with the unread count (hidden at 0, "99+" above 99). */
export function InboxLink({ workspaceId }: { workspaceId: string }) {
  const unread = useUnreadCount(workspaceId).data?.count ?? 0
  const label = unread > 99 ? '99+' : String(unread)
  return (
    <NavLink
      to={inboxPath(workspaceId)}
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
      className={({ isActive }) =>
        `flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors duration-(--tf-dur-fast) hover:bg-surface-2 ${
          isActive ? 'bg-accent-soft font-medium text-accent' : 'text-fg'
        }`
      }
    >
      <span>Inbox</span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          data-testid="inbox-badge"
          className="ml-auto rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg"
        >
          {label}
        </span>
      )}
    </NavLink>
  )
}
