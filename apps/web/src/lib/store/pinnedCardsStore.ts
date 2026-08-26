import { create } from 'zustand'

/**
 * Floating (pinned) card windows — cards popped out of the edit modal that
 * stay open as draggable panels above the board. Purely client-side UI
 * state: nothing here persists or syncs.
 */

export interface PinnedCard {
  taskId: string
  x: number
  y: number
  width: number
  folded: boolean
  /** Monotonic stacking order — higher paints on top. */
  z: number
}

export const DEFAULT_CARD_WIDTH = 480
export const CASCADE_BASE_X = 96
export const CASCADE_BASE_Y = 72
export const CASCADE_STEP = 36
/** Minimum sliver of a window that must stay inside the viewport. */
export const MIN_VISIBLE = 48

const FALLBACK_VIEWPORT = { width: 1280, height: 800 }

function viewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return FALLBACK_VIEWPORT
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Clamp a window position so its title bar always stays reachable. */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  const minX = MIN_VISIBLE - width
  const maxX = Math.max(minX, viewportWidth - MIN_VISIBLE)
  const maxY = Math.max(0, viewportHeight - MIN_VISIBLE)
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, 0), maxY),
  }
}

/** Default spawn position for the nth open window — a diagonal cascade. */
export function cascadePosition(
  index: number,
  viewportWidth: number,
  viewportHeight: number,
  width: number = DEFAULT_CARD_WIDTH
): { x: number; y: number } {
  const slot = index % 8
  return clampPosition(
    CASCADE_BASE_X + slot * CASCADE_STEP,
    CASCADE_BASE_Y + slot * CASCADE_STEP,
    width,
    viewportWidth,
    viewportHeight
  )
}

interface PinnedCardsState {
  cards: PinnedCard[]
  nextZ: number
  /** Pin a card as a floating window (or refocus + unfold if already open). */
  openCard: (taskId: string, pos?: { x: number; y: number }) => void
  closeCard: (taskId: string) => void
  closeAll: () => void
  setPosition: (taskId: string, x: number, y: number) => void
  setFolded: (taskId: string, folded: boolean) => void
  bringToFront: (taskId: string) => void
}

export const usePinnedCardsStore = create<PinnedCardsState>((set, get) => ({
  cards: [],
  nextZ: 1,

  openCard: (taskId, pos) =>
    set((state) => {
      const existing = state.cards.find((c) => c.taskId === taskId)
      if (existing) {
        return {
          cards: state.cards.map((c) =>
            c.taskId === taskId ? { ...c, folded: false, z: state.nextZ } : c
          ),
          nextZ: state.nextZ + 1,
        }
      }
      const vp = viewport()
      const { x, y } = pos
        ? clampPosition(pos.x, pos.y, DEFAULT_CARD_WIDTH, vp.width, vp.height)
        : cascadePosition(state.cards.length, vp.width, vp.height)
      return {
        cards: [
          ...state.cards,
          { taskId, x, y, width: DEFAULT_CARD_WIDTH, folded: false, z: state.nextZ },
        ],
        nextZ: state.nextZ + 1,
      }
    }),

  closeCard: (taskId) =>
    set((state) => ({ cards: state.cards.filter((c) => c.taskId !== taskId) })),

  closeAll: () => set({ cards: [] }),

  setPosition: (taskId, x, y) =>
    set((state) => {
      const card = state.cards.find((c) => c.taskId === taskId)
      if (!card) return state
      const vp = viewport()
      const clamped = clampPosition(x, y, card.width, vp.width, vp.height)
      return {
        cards: state.cards.map((c) =>
          c.taskId === taskId ? { ...c, x: clamped.x, y: clamped.y } : c
        ),
      }
    }),

  setFolded: (taskId, folded) =>
    set((state) => {
      if (!state.cards.some((c) => c.taskId === taskId)) return state
      // Restoring from the dock also brings the window to the front.
      const z = folded ? null : state.nextZ
      return {
        cards: state.cards.map((c) =>
          c.taskId === taskId ? { ...c, folded, ...(z !== null ? { z } : {}) } : c
        ),
        nextZ: z !== null ? state.nextZ + 1 : state.nextZ,
      }
    }),

  bringToFront: (taskId) =>
    set((state) => {
      const card = state.cards.find((c) => c.taskId === taskId)
      if (!card) return state
      // Already on top — don't burn z values on every pointerdown.
      if (state.cards.every((c) => c.taskId === taskId || c.z < card.z)) return state
      return {
        cards: state.cards.map((c) =>
          c.taskId === taskId ? { ...c, z: state.nextZ } : c
        ),
        nextZ: state.nextZ + 1,
      }
    }),
}))

/** True when the task is currently open as a floating window. */
export function isCardPinned(taskId: string): boolean {
  return usePinnedCardsStore.getState().cards.some((c) => c.taskId === taskId)
}
