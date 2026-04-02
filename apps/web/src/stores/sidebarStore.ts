import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarStore {
  collapsed: boolean
  activeRealmId: string | null
  hiddenProjectIds: string[]
  hiddenRealmIds: string[]
  _hydrated: boolean
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  setActiveRealm: (id: string | null) => void
  toggleHideProject: (id: string) => void
  toggleHideRealm: (id: string) => void
  unhideAll: () => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsed: false,
      activeRealmId: null,
      hiddenProjectIds: [],
      hiddenRealmIds: [],
      _hydrated: false,
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (v) => set({ collapsed: v }),
      setActiveRealm: (id) => set({ activeRealmId: id }),
      toggleHideProject: (id) => set((s) => ({
        hiddenProjectIds: s.hiddenProjectIds.includes(id)
          ? s.hiddenProjectIds.filter((p) => p !== id)
          : [...s.hiddenProjectIds, id],
      })),
      toggleHideRealm: (id) => set((s) => ({
        hiddenRealmIds: s.hiddenRealmIds.includes(id)
          ? s.hiddenRealmIds.filter((r) => r !== id)
          : [...s.hiddenRealmIds, id],
      })),
      unhideAll: () => set({ hiddenProjectIds: [], hiddenRealmIds: [] }),
    }),
    {
      name: 'aeon-sidebar',
      partialize: (s) => ({
        collapsed: s.collapsed,
        activeRealmId: s.activeRealmId,
        hiddenProjectIds: s.hiddenProjectIds,
        hiddenRealmIds: s.hiddenRealmIds,
      }),
      onRehydrateStorage: () => () => {
        useSidebarStore.setState({ _hydrated: true })
      },
    }
  )
)
