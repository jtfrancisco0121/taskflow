import { create } from 'zustand'

/** AD-10: UI state only. Expansion is persisted per Workspace as an id list. */
const treeKey = (workspaceId: string) => `taskflow:tree:${workspaceId}`

function readExpanded(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(treeKey(workspaceId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeExpanded(workspaceId: string, ids: string[]) {
  try {
    localStorage.setItem(treeKey(workspaceId), JSON.stringify(ids))
  } catch {
    // storage unavailable: expansion just is not remembered
  }
}

type UiState = {
  sidebarOpen: boolean
  toggleSidebar: () => void
  /** Expanded tree node ids per Workspace; loaded lazily from localStorage. */
  expanded: Record<string, string[]>
  loadExpanded: (workspaceId: string) => void
  setExpanded: (workspaceId: string, nodeId: string, open: boolean) => void
  dropExpanded: (workspaceId: string, nodeIds: string[]) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  expanded: {},
  loadExpanded: (workspaceId) =>
    set((state) => ({ expanded: { ...state.expanded, [workspaceId]: readExpanded(workspaceId) } })),
  setExpanded: (workspaceId, nodeId, open) => {
    const current = get().expanded[workspaceId] ?? readExpanded(workspaceId)
    const next = open
      ? current.includes(nodeId)
        ? current
        : [...current, nodeId]
      : current.filter((id) => id !== nodeId)
    writeExpanded(workspaceId, next)
    set((state) => ({ expanded: { ...state.expanded, [workspaceId]: next } }))
  },
  dropExpanded: (workspaceId, nodeIds) => {
    const current = get().expanded[workspaceId] ?? []
    const next = current.filter((id) => !nodeIds.includes(id))
    if (next.length === current.length) return
    writeExpanded(workspaceId, next)
    set((state) => ({ expanded: { ...state.expanded, [workspaceId]: next } }))
  },
}))
