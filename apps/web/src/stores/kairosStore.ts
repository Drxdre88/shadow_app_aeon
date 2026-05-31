import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Shared client state for the Kairos page so the main AppSidebar can read
// the selection and trigger refreshes without prop-drilling.
interface KairosStore {
  selectedMemoryId: string | null
  setSelected: (id: string | null) => void

  refreshSignal: number
  triggerRefresh: () => void

  // Display: show a label on every node, not just hover / select / hub.
  // Persisted so the user's preference survives reloads. Costly above ~200
  // visible nodes — Html labels are expensive — so it stays opt-in.
  showAllLabels: boolean
  toggleShowAllLabels: () => void
}

export const useKairosStore = create<KairosStore>()(
  persist(
    (set) => ({
      selectedMemoryId: null,
      setSelected: (id) => set({ selectedMemoryId: id }),

      refreshSignal: 0,
      triggerRefresh: () => set((s) => ({ refreshSignal: s.refreshSignal + 1 })),

      showAllLabels: false,
      toggleShowAllLabels: () => set((s) => ({ showAllLabels: !s.showAllLabels })),
    }),
    {
      name: 'aeon-kairos',
      // Persist only the user-facing preferences; selection + refresh are
      // ephemeral per-session.
      partialize: (s) => ({ showAllLabels: s.showAllLabels }),
    },
  ),
)
