import { useNavigate } from 'react-router'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { DropdownMenu, type MenuItem } from '../../shared/ui/DropdownMenu'
import { NEW_WORKSPACE_PATH, workspacePath } from './routes'
import { useWorkspaces } from './useWorkspaces'

const roleLabel = (role?: string) => (role ? role.charAt(0) + role.slice(1).toLowerCase() : '')

/** FR-7: header menu listing Workspaces (name and role), the current one checked. */
export function WorkspaceSwitcher({ currentId }: { currentId: string | undefined }) {
  const navigate = useNavigate()
  const query = useWorkspaces()
  const workspaces = query.data?.pages.flatMap((page) => page.items ?? []) ?? []
  const current = workspaces.find((w) => w.id === currentId)

  const items: MenuItem[] = workspaces.map((workspace) => ({
    type: 'radio',
    label: workspace.name ?? '',
    checked: workspace.id === currentId,
    detail: roleLabel(workspace.role),
    onSelect: () => void navigate(workspacePath(workspace.id!)),
  }))
  if (query.hasNextPage) {
    items.push({
      label: 'Show more',
      keepOpen: true,
      disabled: query.isFetchingNextPage,
      onSelect: () => void query.fetchNextPage(),
    })
  }
  items.push('separator', {
    label: 'New Workspace',
    onSelect: () => void navigate(NEW_WORKSPACE_PATH),
  })

  return (
    <DropdownMenu
      label="Workspaces"
      trigger={
        <Button aria-label="Workspace switcher" className="w-full justify-between">
          {current?.name ?? 'Workspace'} ▾
        </Button>
      }
      header={
        query.isError ? (
          <p role="alert" className="px-2 py-1 text-xs text-danger">
            {messageOf(query.error)}
          </p>
        ) : undefined
      }
      items={items}
    />
  )
}
