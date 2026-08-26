import { create } from 'zustand'

/**
 * Column Zen mode — one column lifted out of the board into a centered focus
 * surface above a blurred backdrop. Purely client-side UI state: nothing
 * here persists or syncs. The source rect is the column's on-board visual
 * rect captured at entry, used as the FLIP flight origin.
 */

export interface ZenRect {
  left: number
  top: number
  width: number
  height: number
}

interface ZenModeState {
  columnId: string | null
  sourceRect: ZenRect | null
  enter: (columnId: string, sourceRect: ZenRect | null) => void
  clear: () => void
}

export const useZenModeStore = create<ZenModeState>((set) => ({
  columnId: null,
  sourceRect: null,
  enter: (columnId, sourceRect) => set({ columnId, sourceRect }),
  clear: () => set({ columnId: null, sourceRect: null }),
}))
