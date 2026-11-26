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
  /** The sidebar's inline "new Space" field is open (also opened by the empty-tree prompt). */
  creatingSpace: boolean
  setCreatingSpace: (value: boolean) => void
  /** The Command palette is open (AppShell mounts it; the shortcut and the top-bar trigger toggle it). */
  paletteOpen: boolean
  setPaletteOpen: (value: boolean) => void
  togglePalette: () => void
  /** AppShell is mounted with a session: the palette can open and run Commands (AD-9). */
  shellReady: boolean
  setShellReady: (value: boolean) => void
  /** Ctrl/Cmd+K pressed before the shell was ready: the palette opens once when it is. */
  paletteRequested: boolean
  setPaletteRequested: (value: boolean) => void
  /** Expanded tree node ids per Workspace; loaded lazily from localStorage. */
  expanded: Record<string, string[]>
  loadExpanded: (workspaceId: string) => void
  setExpanded: (workspaceId: string, nodeId: string, open: boolean) => void
  dropExpanded: (workspaceId: string, nodeIds: string[]) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  creatingSpace: false,
  setCreatingSpace: (value) =>
    set((state) => ({ creatingSpace: value, sidebarOpen: value ? true : state.sidebarOpen })),
  paletteOpen: false,
  setPaletteOpen: (value) => set({ paletteOpen: value }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  shellReady: false,
  setShellReady: (value) => set({ shellReady: value }),
  paletteRequested: false,
  setPaletteRequested: (value) => set({ paletteRequested: value }),
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
