'use client'

import { useEffect } from 'react'
import { parseHangarConfig, useHangarUiStore } from '@/lib/store/hangarUiStore'

/**
 * Mirrors the board's durable Auto AI config (projects.settings.hangar) into
 * the client store so deep board components can read it without prop drilling.
 * Cleared on unmount: a stale enabled-config must never leak onto the next
 * board the operator opens.
 */
export function useHangarBoardConfig(projectId: string, settings: unknown) {
  useEffect(() => {
    const config = parseHangarConfig(settings)
    useHangarUiStore.getState().setConfig(projectId, config)
    return () => {
      useHangarUiStore.setState({
        projectId: null,
        config: { enabled: false, triggerColumnId: null },
        missionEditorTaskId: null,
      })
    }
  }, [projectId, settings])
}
