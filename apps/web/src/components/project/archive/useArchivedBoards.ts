'use client'

import { useCallback, useEffect, useState } from 'react'
import { getArchivedProjects } from '@/lib/actions/project-archive'
import type { ArchivedProjectView } from '@/lib/projects/archive'
import { useOnArchiveChange } from './archive-events'

export type ArchivedBoardsStatus = 'loading' | 'ready' | 'error'

/** The viewer's archived boards, refetched whenever any surface archives or restores one. */
export function useArchivedBoards() {
  const [boards, setBoards] = useState<ArchivedProjectView[]>([])
  const [status, setStatus] = useState<ArchivedBoardsStatus>('loading')

  const reload = useCallback(async () => {
    try {
      const next = await getArchivedProjects()
      setBoards(next)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  useOnArchiveChange(reload)

  return { boards, status, reload }
}
