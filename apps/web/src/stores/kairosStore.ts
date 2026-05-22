import { create } from 'zustand'

// Shared client state for the Kairos page so the main AppSidebar can read
// the selection and trigger refreshes without prop-drilling.
interface KairosStore {
  selectedMemoryId: string | null
  setSelected: (id: string | null) => void

  refreshSignal: number
  triggerRefresh: () => void
}

export const useKairosStore = create<KairosStore>((set) => ({
  selectedMemoryId: null,
  setSelected: (id) => set({ selectedMemoryId: id }),

  refreshSignal: 0,
  triggerRefresh: () => set((s) => ({ refreshSignal: s.refreshSignal + 1 })),
}))
