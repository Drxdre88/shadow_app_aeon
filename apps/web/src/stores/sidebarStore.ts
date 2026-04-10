import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarStore {
  collapsed: boolean
  activeRealmId: string | null
  hiddenProjectIds: string[]
  hiddenRealmIds: string[]
  _hydrated: boolean
  _initializedForViewport: boolean
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  setActiveRealm: (id: string | null) => void
  toggleHideProject: (id: string) => void
  toggleHideRealm: (id: string) => void
  unhideAll: () => void
  maybeAutoCollapseForViewport: () => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set, get) => ({
      collapsed: false,
      activeRealmId: null,
      hiddenProjectIds: [],
      hiddenRealmIds: [],
      _hydrated: false,
      _initializedForViewport: false,
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
      maybeAutoCollapseForViewport: () => {
        if (typeof window === 'undefined') return
        if (get()._initializedForViewport) return
        const isMobile = window.matchMedia('(max-width: 768px)').matches
        set({
          collapsed: isMobile ? true : get().collapsed,
          _initializedForViewport: true,
        })
      },
    }),
    {
      name: 'aeon-sidebar',
      partialize: (s) => ({
        collapsed: s.collapsed,
        activeRealmId: s.activeRealmId,
        hiddenProjectIds: s.hiddenProjectIds,
        hiddenRealmIds: s.hiddenRealmIds,
        _initializedForViewport: s._initializedForViewport,
      }),
      onRehydrateStorage: () => () => {
        useSidebarStore.setState({ _hydrated: true })
      },
    }
  )
)
