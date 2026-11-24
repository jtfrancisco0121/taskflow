import { useParams } from 'react-router'
import { Button } from '../../shared/ui/Button'
import { useUiStore } from '../../shared/ui-store'
import { useTreeChildren } from './useTreeChildren'

/** Main area of `/w/:workspaceId`: the empty-tree prompt, or "Pick a List". */
export function WorkspaceHomePage() {
  const { workspaceId } = useParams()
  const root = useTreeChildren(workspaceId ?? '', 'root', !!workspaceId)
  const setCreatingSpace = useUiStore((state) => state.setCreatingSpace)

  if (!root.isSuccess) return null
  if (root.data.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>This Workspace has no Spaces yet.</p>
        <Button variant="primary" onClick={() => setCreatingSpace(true)}>
          Create Space
        </Button>
      </div>
    )
  }
  return <p className="text-slate-600">Pick a List in the sidebar.</p>
}
