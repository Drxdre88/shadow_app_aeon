import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarStore {
  collapsed: boolean
  activeRealmId: string | null
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  setActiveRealm: (id: string | null) => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsed: false,
      activeRealmId: null,
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (v) => set({ collapsed: v }),
      setActiveRealm: (id) => set({ activeRealmId: id }),
    }),
    {
      name: 'aeon-sidebar',
      partialize: (s) => ({ collapsed: s.collapsed, activeRealmId: s.activeRealmId }),
    }
  )
)
