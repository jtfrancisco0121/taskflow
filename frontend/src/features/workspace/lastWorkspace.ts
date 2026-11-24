/** The only persisted navigation hint (AD-3): read only when no Workspace is in the URL. */
const KEY = 'taskflow:lastWorkspace'

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeLastWorkspace(workspaceId: string) {
  try {
    localStorage.setItem(KEY, workspaceId)
  } catch {
    // not remembered
  }
}
