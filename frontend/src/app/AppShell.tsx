import { useEffect } from 'react'
import { Outlet, useMatch, useParams } from 'react-router'
import { useTaskWorkspaceId } from '../features/tasks'
import { SidebarTree } from '../features/locations'
import { useSession, useSignOut } from '../features/auth'
import { InboxLink, NotificationBell } from '../features/notifications'
import { LiveUpdates } from '../features/realtime'
import { SearchBox } from '../features/search'
import { ServiceAccountsLink } from '../features/serviceAccounts'
import { useRememberWorkspace, WorkspaceSwitcher } from '../features/workspace'
import { Button } from '../shared/ui/Button'
import { Kbd } from '../shared/ui/Kbd'
import { IconButton } from '../shared/ui/IconButton'
import { ThemeSwitcher } from '../shared/ui/ThemeSwitcher'
import { useUiStore } from '../shared/ui-store'
import { CommandPalette, shortcutHint } from './palette/CommandPalette'
import { ShortcutSheet } from './shortcuts/ShortcutSheet'

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}

/**
 * The signed-in frame (AD-6): a frosted sidebar, a top bar and a main region that is the only scroll
 * container, so the window never scrolls.
 */
export function AppShell() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const togglePalette = useUiStore((state) => state.togglePalette)
  const setShellReady = useUiStore((state) => state.setShellReady)
  // AD-9: ready means "the shell is mounted with a session", never "a Workspace is resolved": /setup and a
  // hidden /t/:id render here without one and keep their palette.
  useEffect(() => {
    setShellReady(true)
    return () => setShellReady(false)
  }, [setShellReady])
  const session = useSession()
  const signOut = useSignOut()
  const { workspaceId: urlWorkspaceId, taskId, locationId } = useParams()
  // AD-3: the current Workspace is in the URL, or on /t/:taskId the loaded task's Workspace.
  const taskWorkspaceId = useTaskWorkspaceId(taskId)
  const workspaceId = urlWorkspaceId ?? taskWorkspaceId
  useRememberWorkspace(workspaceId)
  // On /t/:taskId the route lays out its own columns, each scrolling on its own, so main never scrolls.
  const onTaskRoute = useMatch('/t/:taskId') !== null

  return (
    <LiveUpdates workspaceId={workspaceId} locationId={locationId} taskId={taskId}>
      <div className="flex h-dvh overflow-hidden text-fg">
        {sidebarOpen && (
          <aside
            aria-label="Sidebar"
            className="glass flex w-[236px] shrink-0 flex-col gap-3 !rounded-none !border-y-0 !border-l-0 p-3 text-[13px] !shadow-none"
          >
            <div className="flex flex-col gap-2">
              <span className="px-2 font-display text-lg font-bold">Taskflow</span>
              <WorkspaceSwitcher currentId={workspaceId} />
            </div>
            {workspaceId && <InboxLink workspaceId={workspaceId} />}
            <nav aria-label="Locations" className="min-h-0 flex-1 overflow-auto">
              {workspaceId && <SidebarTree workspaceId={workspaceId} />}
            </nav>
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <ThemeSwitcher />
              <div className="flex items-center gap-2 px-1">
                {session.user?.displayName && (
                  <span className="min-w-0 flex-1 truncate">{session.user.displayName}</span>
                )}
                <Button variant="ghost" className="ml-auto" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            </div>
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass flex h-12 shrink-0 items-center gap-3 !rounded-none !border-x-0 !border-t-0 px-3 !shadow-none">
            <IconButton label="Toggle sidebar" aria-expanded={sidebarOpen} onClick={toggleSidebar}>
              <MenuIcon />
            </IconButton>
            <button
              type="button"
              aria-label="Command palette"
              onClick={togglePalette}
              className="flex h-8 w-[220px] items-center gap-2 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-muted hover:bg-surface-2"
            >
              <SearchIcon />
              <span className="flex-1 text-left">Search or jump</span>
              <Kbd>{shortcutHint()}</Kbd>
            </button>
            {workspaceId && <SearchBox workspaceId={workspaceId} />}
            <div className="ml-auto flex items-center gap-3 text-[13px]">
              {workspaceId && <NotificationBell workspaceId={workspaceId} />}
              {workspaceId && <ServiceAccountsLink workspaceId={workspaceId} />}
            </div>
          </header>
          <main
            className={`min-h-0 min-w-0 flex-1 ${onTaskRoute ? 'overflow-hidden' : 'overflow-auto p-6'}`}
          >
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette workspaceId={workspaceId} locationId={locationId} />
      <ShortcutSheet />
    </LiveUpdates>
  )
}
