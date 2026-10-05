import { create } from 'zustand'

// Open state for the "What Vorath knows" drawer, plus a version counter the
// memory panel bumps after an owner fix so the lists refetch.
export type KnowsTab = 'knows' | 'eyes'

interface KnowsStore {
  open: boolean
  tab: KnowsTab
  version: number
  setOpen: (open: boolean) => void
  toggle: () => void
  setTab: (tab: KnowsTab) => void
  bump: () => void
}

export const useKnowsStore = create<KnowsStore>()((set) => ({
  open: false,
  tab: 'knows',
  version: 0,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setTab: (tab) => set({ tab }),
  bump: () => set((s) => ({ version: s.version + 1 })),
}))
