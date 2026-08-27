import { create } from 'zustand'

/**
 * Auto AI (Hangar) board-side UI state. Client-only; the durable config lives
 * in `projects.settings.hangar` and is hydrated here when a board loads, so
 * deeply nested board components (quick-add, context menus, column headers)
 * can read it without prop-drilling through the whole board tree.
 */

export interface HangarBoardConfig {
  enabled: boolean
  /** Column that fires auto-run missions when a card is dropped into it. */
  triggerColumnId: string | null
}

interface HangarUiState {
  projectId: string | null
  config: HangarBoardConfig
  /** Card currently open in the mission editor, null when closed. */
  missionEditorTaskId: string | null
  setConfig: (projectId: string, config: HangarBoardConfig) => void
  openMissionEditor: (taskId: string) => void
  closeMissionEditor: () => void
}

const DISABLED: HangarBoardConfig = { enabled: false, triggerColumnId: null }

export function parseHangarConfig(settings: unknown): HangarBoardConfig {
  const hangar = (settings as { hangar?: unknown } | null)?.hangar
  if (!hangar || typeof hangar !== 'object') return DISABLED
  const h = hangar as { enabled?: unknown; triggerColumnId?: unknown }
  return {
    enabled: h.enabled === true,
    triggerColumnId: typeof h.triggerColumnId === 'string' ? h.triggerColumnId : null,
  }
}

export const useHangarUiStore = create<HangarUiState>((set) => ({
  projectId: null,
  config: DISABLED,
  missionEditorTaskId: null,
  setConfig: (projectId, config) => set({ projectId, config }),
  openMissionEditor: (taskId) => set({ missionEditorTaskId: taskId }),
  closeMissionEditor: () => set({ missionEditorTaskId: null }),
}))
