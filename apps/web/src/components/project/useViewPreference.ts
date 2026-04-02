'use client'

import { useState, useCallback, useEffect } from 'react'

export type ProjectViewMode = 'grid' | 'tree' | 'space'

const STORAGE_KEY = 'aeon-project-view'

export function useViewPreference(): [ProjectViewMode, (mode: ProjectViewMode) => void] {
  const [view, setViewState] = useState<ProjectViewMode>('grid')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ProjectViewMode | null
    if (stored && ['grid', 'tree', 'space'].includes(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewState(stored)
    }
  }, [])

  const setView = useCallback((mode: ProjectViewMode) => {
    setViewState(mode)
    localStorage.setItem(STORAGE_KEY, mode)
  }, [])

  return [view, setView]
}
