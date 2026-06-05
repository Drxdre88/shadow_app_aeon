import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Which node titles get a persistent label, by recency of the memory:
//   today → created today · week → created in the last 7 days · none → hidden.
// (hover / select labels always show regardless of mode.)
export type LabelMode = 'today' | 'week' | 'none'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// The createdAt cutoff (epoch ms) a node must beat to earn a persistent label,
// or null for 'none' (no persistent labels at all). Computed once per mode
// change inside a useMemo at the call site to stay render-pure.
export function labelRecencyCutoff(mode: LabelMode): number | null {
  if (mode === 'none') return null
  if (mode === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  return Date.now() - WEEK_MS
}

// Shared client state for the Kairos page so the main AppSidebar can read
// the selection and trigger refreshes without prop-drilling.
interface KairosStore {
  selectedMemoryId: string | null
  setSelected: (id: string | null) => void

  refreshSignal: number
  triggerRefresh: () => void

  // Display: which node titles carry a persistent label. Persisted so the
  // user's preference survives reloads. All-node labels are costly above ~200
  // visible nodes (Html labels are expensive), so recency narrows the set.
  labelMode: LabelMode
  setLabelMode: (mode: LabelMode) => void
}

export const useKairosStore = create<KairosStore>()(
  persist(
    (set) => ({
      selectedMemoryId: null,
      setSelected: (id) => set({ selectedMemoryId: id }),

      refreshSignal: 0,
      triggerRefresh: () => set((s) => ({ refreshSignal: s.refreshSignal + 1 })),

      labelMode: 'today',
      setLabelMode: (mode) => set({ labelMode: mode }),
    }),
    {
      name: 'aeon-kairos',
      // Persist only the user-facing preferences; selection + refresh are
      // ephemeral per-session.
      partialize: (s) => ({ labelMode: s.labelMode }),
      // v0 stored a boolean `showAllLabels`; the axis is now a 3-way recency
      // mode, so reset migrated clients to the sensible default.
      version: 1,
      migrate: () => ({ labelMode: 'today' as LabelMode }),
    },
  ),
)
