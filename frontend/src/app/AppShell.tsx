import { Outlet, useParams } from 'react-router'
import { SidebarTree } from '../features/locations'
import { useSession, useSignOut } from '../features/auth'
import { useRememberWorkspace, WorkspaceSwitcher } from '../features/workspace'
import { Button } from '../shared/ui/Button'
import { useUiStore } from '../shared/ui-store'

export function AppShell() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const session = useSession()
  const signOut = useSignOut()
  const { workspaceId } = useParams()
  useRememberWorkspace(workspaceId)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
          onClick={toggleSidebar}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100"
        >
          Menu
        </button>
        <span className="text-lg font-bold">Taskflow</span>
        <WorkspaceSwitcher currentId={workspaceId} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          {session.user?.displayName && <span>{session.user.displayName}</span>}
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>
      <div className="flex flex-1">
        {sidebarOpen && (
          <aside
            aria-label="Sidebar"
            className="w-56 border-r border-slate-200 bg-white p-4 text-sm"
          >
            <nav aria-label="Locations">
              {workspaceId && <SidebarTree workspaceId={workspaceId} />}
            </nav>
          </aside>
        )}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
