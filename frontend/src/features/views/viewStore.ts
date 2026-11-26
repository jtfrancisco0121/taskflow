import { create } from 'zustand'

export type EditorField = 'status' | 'priority' | 'assignee' | 'due' | 'start'

/**
 * AD-19, AD-3: Zustand holds the UI-only List state: collapsed groups, the row selection, the focused row and the
 * one open popover editor. The URL holds everything else.
 */
type ViewUi = {
  collapsed: Record<string, boolean>
  toggleGroup: (key: string) => void
  selected: string[]
  setSelected: (ids: string[]) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  focusedTaskId: string | null
  setFocusedTaskId: (id: string | null) => void
  openEditor: { taskId: string; field: EditorField } | null
  setOpenEditor: (editor: { taskId: string; field: EditorField } | null) => void
  /** The location scope or view changed: nothing selected, focused or open any more. */
  resetTransient: () => void
}

export const useViewStore = create<ViewUi>((set) => ({
  collapsed: {},
  toggleGroup: (key) => set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
  selected: [],
  setSelected: (ids) => set({ selected: ids }),
  toggleSelected: (id) =>
    set((s) => ({
      selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id],
    })),
  clearSelection: () => set({ selected: [] }),
  focusedTaskId: null,
  setFocusedTaskId: (id) => set({ focusedTaskId: id }),
  openEditor: null,
  setOpenEditor: (editor) => set({ openEditor: editor }),
  resetTransient: () => set({ selected: [], focusedTaskId: null, openEditor: null }),
}))
