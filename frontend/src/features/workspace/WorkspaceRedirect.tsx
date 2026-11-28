import { Navigate } from 'react-router'
import { messageOf } from '../../api/errors'
import { readLastWorkspace } from './lastWorkspace'
import { useAllWorkspaces } from './useWorkspaces'
import { loadFailed, refreshFailed } from '../../api/queryState'

/** FR-6, FR-7: `/` goes to the last Workspace if still available, else the first, else /setup. */
export function WorkspaceRedirect() {
  const all = useAllWorkspaces()
  const { workspaces, done, error } = all
  // 14yq6g334fe: a failed refresh of a complete list still redirects; an error that leaves the list incomplete does not.
  if (!done && (loadFailed(all) || refreshFailed(all))) {
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
