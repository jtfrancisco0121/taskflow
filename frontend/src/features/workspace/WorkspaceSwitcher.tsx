import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { messageOf } from '../../api/errors'
import { useWorkspaces } from './useWorkspaces'

const roleLabel = (role?: string) => (role ? role.charAt(0) + role.slice(1).toLowerCase() : '')

/** FR-7: header menu listing Workspaces (name and role), the current one checked. */
export function WorkspaceSwitcher({ currentId }: { currentId: string | undefined }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const query = useWorkspaces()
  const rootRef = useRef<HTMLDivElement>(null)
  const workspaces = query.data?.pages.flatMap((page) => page.items ?? []) ?? []
  const current = workspaces.find((w) => w.id === currentId)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Workspace switcher"
        onClick={() => setOpen((value) => !value)}
        className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
      >
        {current?.name ?? 'Workspace'} ▾
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute left-0 z-20 mt-1 w-64 rounded border border-slate-200 bg-white py-1 shadow-lg"
        >
          {query.isError && (
            <p role="alert" className="px-3 py-1 text-sm text-red-700">
              {messageOf(query.error)}
            </p>
          )}
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="menuitemradio"
              aria-checked={workspace.id === currentId}
              onClick={() => {
                setOpen(false)
                void navigate(`/w/${workspace.id}`)
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-100"
            >
              <span>
                {workspace.id === currentId ? '✓ ' : ''}
                {workspace.name}
              </span>
              <span className="text-xs text-slate-500">{roleLabel(workspace.role)}</span>
            </button>
          ))}
          {query.hasNextPage && (
            <button
              type="button"
              role="menuitem"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="w-full px-3 py-1.5 text-left text-sm text-blue-700 hover:bg-slate-100"
            >
              Show more
            </button>
          )}
          <Link
            to="/setup"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            New Workspace
          </Link>
        </div>
      )}
    </div>
  )
}
