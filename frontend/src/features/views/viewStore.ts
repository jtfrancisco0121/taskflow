import { create } from 'zustand'

/** AD-19: Zustand holds only collapsed groups and the row selection; the URL holds everything else. */
type ViewUi = {
  collapsed: Record<string, boolean>
  toggleGroup: (key: string) => void
  selected: string[]
  setSelected: (ids: string[]) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
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
}))
