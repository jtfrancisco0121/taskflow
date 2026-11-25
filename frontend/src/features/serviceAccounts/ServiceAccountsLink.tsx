import { Link } from 'react-router'
import { serviceAccountsPath } from './routes'
import { useCanManageServiceAccounts } from './useCanManageServiceAccounts'

/** The header entry to agent access; only owners and admins see it. */
export function ServiceAccountsLink({ workspaceId }: { workspaceId: string }) {
  if (!useCanManageServiceAccounts(workspaceId)) return null
  return (
    <Link
      to={serviceAccountsPath(workspaceId)}
      className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
    >
      Settings
    </Link>
  )
}
