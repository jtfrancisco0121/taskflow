import { Link } from 'react-router'
import { useWorkspaces } from '../workspace'

/** The header entry to agent access; only owners and admins see it. */
export function ServiceAccountsLink({ workspaceId }: { workspaceId: string }) {
  const query = useWorkspaces()
  const current = query.data?.pages
    .flatMap((page) => page.items ?? [])
    .find((workspace) => workspace.id === workspaceId)
  if (current?.role !== 'OWNER' && current?.role !== 'ADMIN') return null
  return (
    <Link
      to={`/w/${workspaceId}/settings/service-accounts`}
      className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
    >
      Settings
    </Link>
  )
}
