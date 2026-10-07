'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui/Toast'
import { getProjectArchiveSetting, setProjectArchived } from '@/lib/actions/project-archive'
import { ArchiveConfirm } from './ArchiveConfirm'
import { announceArchiveChange } from './archive-events'

type MenuBoard = { id: string; name: string }

/**
 * Archive support for a project right-click menu: asks the server whether the
 * viewer created the open board (only once the menu opens), and owns the
 * confirm dialog so it outlives the menu.
 */
export function useMenuArchive(menuProjectId: string | null | undefined) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<{ id: string; can: boolean } | null>(null)
  const [pending, setPending] = useState<MenuBoard | null>(null)

  useEffect(() => {
    if (!menuProjectId) return
    let cancelled = false
    getProjectArchiveSetting(menuProjectId)
      .then((s) => { if (!cancelled) setAllowed({ id: menuProjectId, can: s.canToggle && !s.archived }) })
      .catch(() => { if (!cancelled) setAllowed({ id: menuProjectId, can: false }) })
    return () => { cancelled = true }
  }, [menuProjectId])

  const confirmArchive = async () => {
    if (!pending) return
    const board = pending
    setPending(null)
    try {
      await setProjectArchived(board.id, true)
      announceArchiveChange()
      toast(`"${board.name}" archived`)
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not archive this board')
    }
  }

  return {
    canArchive: !!menuProjectId && allowed?.id === menuProjectId && allowed.can,
    requestArchive: (board: MenuBoard) => setPending(board),
    dialog: (
      <ArchiveConfirm
        boardName={pending?.name ?? null}
        onConfirm={() => { void confirmArchive() }}
        onCancel={() => setPending(null)}
      />
    ),
  }
}
