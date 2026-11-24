import { Navigate } from 'react-router'
import { messageOf } from '../../api/errors'
import { readLastWorkspace } from './lastWorkspace'
import { useAllWorkspaces } from './useWorkspaces'

/** FR-6, FR-7: `/` goes to the last Workspace if still available, else the first, else /setup. */
export function WorkspaceRedirect() {
  const { workspaces, done, isError, error } = useAllWorkspaces()
  if (isError) {
    return (
      <p role="alert" className="text-red-700">
        {messageOf(error)}
      </p>
    )
  }
  if (!done) return <p role="status">Loading…</p>
  if (workspaces.length === 0) return <Navigate to="/setup" replace />
  const last = readLastWorkspace()
  const target = workspaces.find((w) => w.id === last) ?? workspaces[0]
  return <Navigate to={`/w/${target.id}`} replace />
}
