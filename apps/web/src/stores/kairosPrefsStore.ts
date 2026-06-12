import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '@/components/kairos/nodeColor'
import { KAIROS_DEFAULT_SKYBOX, type SkyboxId } from '@/components/skybox/skyboxes'

// User-scoped view preferences for the Kairos page. Persisted so the
// view/color-mode/backdrop the operator picked yesterday is what greets
// them today. Default colour mode is `dominion` — the recommended lens
// since Dominions group cross-repo work.

export type KairosViewMode = '3d' | '2d' | 'table' | 'aether'
export type KairosColorMode = ColorMode
export type KairosSkybox = SkyboxId
export type KairosBackdrop = 'cortex' | 'aeon' | 'art'
// How far back the graph reaches. Windowing is client-side over createdAt —
// the rail stats stay on the full set; only the canvas is filtered.
export type KairosTimeWindow = 'all' | '30d' | '7d' | '1d'

interface KairosPrefsStore {
  view: KairosViewMode
  colorMode: KairosColorMode
  skybox: KairosSkybox
  backdrop: KairosBackdrop
  // How far back in time the graph reaches (lookback selector on the rail).
  timeWindow: KairosTimeWindow
  // Zen mode: strip all chrome, leave only space + nodes.
  zenMode: boolean
  // When colorMode is 'repo', hide nodes that have no repo so the repo
  // view stays clean instead of being drowned by unanchored memories.
  hideUnanchoredInRepo: boolean
  // Right tracking rail collapsed (slid away to the right edge).
  railCollapsed: boolean

  setView: (v: KairosViewMode) => void
  setColorMode: (m: KairosColorMode) => void
  setSkybox: (s: KairosSkybox) => void
  setBackdrop: (b: KairosBackdrop) => void
  setTimeWindow: (w: KairosTimeWindow) => void
  setZenMode: (z: boolean) => void
  toggleZen: () => void
  setHideUnanchoredInRepo: (h: boolean) => void
  toggleRail: () => void
}

export const useKairosPrefsStore = create<KairosPrefsStore>()(
  persist(
    (set) => ({
      view: '3d',
      colorMode: 'dominion',
      skybox: KAIROS_DEFAULT_SKYBOX,
      backdrop: 'cortex',
      timeWindow: 'all',
      zenMode: false,
      hideUnanchoredInRepo: true,
      railCollapsed: false,
      setView: (v) => set({ view: v }),
      setColorMode: (m) => set({ colorMode: m }),
      setSkybox: (s) => set({ skybox: s }),
      setBackdrop: (b) => set({ backdrop: b }),
      setTimeWindow: (w) => set({ timeWindow: w }),
      setZenMode: (z) => set({ zenMode: z }),
      toggleZen: () => set((s) => ({ zenMode: !s.zenMode })),
      setHideUnanchoredInRepo: (h) => set({ hideUnanchoredInRepo: h }),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
    }),
    { name: 'aeon-kairos-prefs' },
  ),
)
