'use client'

import { useEffect } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { updateProjectSettings } from '@/lib/actions/projects'
import type { ThemeName } from '@aeon/shared'

export function useBoardTheme(projectId: string, settings: Record<string, unknown>) {
  const applyBoardTheme = useThemeStore((s) => s.applyBoardTheme)
  const clearBoardTheme = useThemeStore((s) => s.clearBoardTheme)

  useEffect(() => {
    const boardTheme = settings?.boardTheme as ThemeName | undefined
    if (boardTheme) {
      applyBoardTheme(projectId, boardTheme)
    }
    return () => {
      clearBoardTheme()
    }
  }, [projectId, settings?.boardTheme, applyBoardTheme, clearBoardTheme])
}

export async function setProjectBoardTheme(projectId: string, themeName: ThemeName | null) {
  const store = useThemeStore.getState()

  if (themeName) {
    store.applyBoardTheme(projectId, themeName)
  } else {
    store.clearBoardTheme()
  }
  // Send ONLY the key being changed: settings is merged in SQL, so replaying
  // a whole client snapshot would resurrect keys another writer removed.
  await updateProjectSettings(projectId, { boardTheme: themeName })
}
