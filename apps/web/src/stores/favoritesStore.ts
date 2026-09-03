import { create } from 'zustand'

// Client-side mirror of the user's favorited projects, shared by every star
// toggle surface (board header star, dashboard cards) and the sidebar
// Favorites group so a toggle anywhere updates the sidebar instantly.
// Server truth lives in favoriteProjects (lib/data/projects.ts); this store is
// hydrated from getFavoriteProjects() and patched optimistically on toggles.

export interface FavoriteEntry {
  id: string
  name: string
  /** Epoch ms of when the project was favorited — drives stable ordering. */
  favoritedAt: number
}

interface FavoritesStore {
  /** null = not yet hydrated from the server (sidebar renders nothing). */
  entries: FavoriteEntry[] | null
  setEntries: (entries: FavoriteEntry[]) => void
  /**
   * Optimistic patch from any star toggle. Adding requires `info.name`
   * (skipped otherwise — the next hydrate picks it up). No-op until the
   * store has been hydrated, so a lone toggle can never masquerade as the
   * full favorites list.
   */
  applyToggle: (projectId: string, favorite: boolean, info?: { name: string; favoritedAt?: number }) => void
}

export const useFavoritesStore = create<FavoritesStore>()((set) => ({
  entries: null,
  setEntries: (entries) => set({ entries }),
  applyToggle: (projectId, favorite, info) => set((s) => {
    if (s.entries === null) return s
    if (favorite) {
      if (!info?.name || s.entries.some((e) => e.id === projectId)) return s
      return {
        entries: [...s.entries, { id: projectId, name: info.name, favoritedAt: info.favoritedAt ?? Date.now() }],
      }
    }
    if (!s.entries.some((e) => e.id === projectId)) return s
    return { entries: s.entries.filter((e) => e.id !== projectId) }
  }),
}))

/**
 * Pure derivation of the sidebar Favorites list: drops sidebar-hidden
 * projects, orders by when each was favorited (oldest star first — stable as
 * new stars append), name as tiebreak. Returns [] for the not-yet-hydrated
 * and empty states so callers can simply hide the section when empty.
 */
export function deriveFavoritesList(
  entries: FavoriteEntry[] | null,
  hiddenProjectIds: readonly string[],
): FavoriteEntry[] {
  if (!entries || entries.length === 0) return []
  const hidden = new Set(hiddenProjectIds)
  return entries
    .filter((e) => !hidden.has(e.id))
    .sort((a, b) => (a.favoritedAt - b.favoritedAt) || a.name.localeCompare(b.name))
}
