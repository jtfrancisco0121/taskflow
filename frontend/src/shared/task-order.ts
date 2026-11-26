import { create } from 'zustand'

/**
 * The ids of the tasks the List behind the task detail shows, in display order. The List writes it and clears it
 * when it goes away; the task detail reads it for j/k, so `tasks` never imports `views` (AD-6).
 */
export const useTaskOrder = create<{ ids: string[]; setIds: (ids: string[]) => void }>((set) => ({
  ids: [],
  setIds: (ids) => set({ ids }),
}))
