import { useEffect } from 'react'
import { writeLastWorkspace } from './lastWorkspace'

/** Stores the current Workspace id so `/` can return to it after a reload. */
export function useRememberWorkspace(workspaceId: string | undefined) {
  useEffect(() => {
    if (workspaceId) writeLastWorkspace(workspaceId)
  }, [workspaceId])
}
