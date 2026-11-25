import { useWorkspaces } from '../workspace'

/** Agent access is for owners and admins of the Workspace only. */
export function useCanManageServiceAccounts(workspaceId: string | undefined): boolean {
  const query = useWorkspaces()
  const current = query.data?.pages
    .flatMap((page) => page.items ?? [])
    .find((workspace) => workspace.id === workspaceId)
  return current?.role === 'OWNER' || current?.role === 'ADMIN'
}
