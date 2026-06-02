import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C1) — Visor slide-out state.
//
// Tracks open/closed + the active thread id. Both ephemeral; we persist
// only the last-active thread so reopening the Visor lands you where you
// were instead of on a blank "new conversation" picker. Open state is
// NOT persisted — closing the Visor and reloading should not auto-reopen
// it next visit.
// ─────────────────────────────────────────────────────────────────────────

interface KairosVisorStore {
  isOpen: boolean
  activeThreadId: string | null

  open: () => void
  close: () => void
  setActiveThread: (id: string | null) => void
}

export const useKairosVisorStore = create<KairosVisorStore>()(
  persist(
    (set) => ({
      isOpen: false,
      activeThreadId: null,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setActiveThread: (id) => set({ activeThreadId: id }),
    }),
    {
      name: 'aeon-kairos-visor',
      partialize: (s) => ({ activeThreadId: s.activeThreadId }),
    },
  ),
)
