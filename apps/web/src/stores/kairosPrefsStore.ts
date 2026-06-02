import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '@/components/kairos/nodeColor'

// User-scoped view preferences for the Kairos page. Persisted so the
// view/color-mode/backdrop the operator picked yesterday is what greets
// them today. Default colour mode is `dominion` — the recommended lens
// since Dominions group cross-repo work.

export type KairosViewMode = '3d' | '2d' | 'table'
export type KairosColorMode = ColorMode
export type KairosSkybox = 'nebula-4k' | 'lunar-4k' | 'lunar-8k'
export type KairosBackdrop = 'cortex' | 'aeon' | 'art'

interface KairosPrefsStore {
  view: KairosViewMode
  colorMode: KairosColorMode
  skybox: KairosSkybox
  backdrop: KairosBackdrop
  // When colorMode is 'repo', hide nodes that have no repo so the repo
  // view stays clean instead of being drowned by unanchored memories.
  hideUnanchoredInRepo: boolean

  setView: (v: KairosViewMode) => void
  setColorMode: (m: KairosColorMode) => void
  setSkybox: (s: KairosSkybox) => void
  setBackdrop: (b: KairosBackdrop) => void
  setHideUnanchoredInRepo: (h: boolean) => void
}

export const useKairosPrefsStore = create<KairosPrefsStore>()(
  persist(
    (set) => ({
      view: '3d',
      colorMode: 'dominion',
      skybox: 'lunar-4k',
      backdrop: 'cortex',
      hideUnanchoredInRepo: true,
      setView: (v) => set({ view: v }),
      setColorMode: (m) => set({ colorMode: m }),
      setSkybox: (s) => set({ skybox: s }),
      setBackdrop: (b) => set({ backdrop: b }),
      setHideUnanchoredInRepo: (h) => set({ hideUnanchoredInRepo: h }),
    }),
    { name: 'aeon-kairos-prefs' },
  ),
)
