'use client'

import { create } from 'zustand'

// Shared UI state for the Aether scene. Lives in a store (not React state)
// because the r3f Canvas children, the DOM overlay, AND the Kairos top-bar
// toggles all read/write it. One interaction model: click an orb to select it
// (it glows up, the rest dim) and read it in the Reader pane. The Core crystal
// (bottom-centre) opens the narrative modal. Legend + Reader visibility are
// driven by segmented toggles in the top bar.
interface AetherUiState {
  selectedId: string | null
  hoveredId: string | null
  /** Legend panel visible (top-bar toggle); draggable when shown. */
  legendOpen: boolean
  /** Reader pane visible (top-bar toggle); draggable + resizable when shown. */
  readerOpen: boolean
  /** Core narrative modal open (opened by the bottom-centre Core crystal). */
  narrativeOpen: boolean

  select: (id: string | null) => void
  hover: (id: string | null) => void
  setLegendOpen: (open: boolean) => void
  toggleLegend: () => void
  setReaderOpen: (open: boolean) => void
  toggleReader: () => void
  closeReader: () => void
  setNarrativeOpen: (open: boolean) => void
}

export const useAetherUi = create<AetherUiState>((set) => ({
  selectedId: null,
  hoveredId: null,
  legendOpen: false,
  readerOpen: false,
  narrativeOpen: false,

  // Selecting a thought auto-opens the Reader pane so its insight is readable.
  select: (id) => set((s) => ({ selectedId: id, readerOpen: id ? true : s.readerOpen })),
  hover: (hoveredId) => set({ hoveredId }),
  setLegendOpen: (legendOpen) => set({ legendOpen }),
  toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen })),
  setReaderOpen: (readerOpen) => set({ readerOpen }),
  toggleReader: () => set((s) => ({ readerOpen: !s.readerOpen })),
  // Closing the pane also clears selection so the field returns to neutral.
  closeReader: () => set({ readerOpen: false, selectedId: null }),
  setNarrativeOpen: (narrativeOpen) => set({ narrativeOpen }),
}))
