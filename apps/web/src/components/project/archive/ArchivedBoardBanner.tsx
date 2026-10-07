'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2, RotateCcw } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { getProjectArchiveSetting, setProjectArchived } from '@/lib/actions/project-archive'
import { announceArchiveChange, useOnArchiveChange } from './archive-events'

interface ArchivedBoardBannerProps {
  projectId: string
  initiallyArchived: boolean
}

/** Slim notice on a board opened by direct link after it was archived; the creator can restore it in place. */
export function ArchivedBoardBanner({ projectId, initiallyArchived }: ArchivedBoardBannerProps) {
  const router = useRouter()
  const [archived, setArchived] = useState(initiallyArchived)
  const [canRestore, setCanRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await getProjectArchiveSetting(projectId)
      setArchived(s.archived)
      setCanRestore(s.canToggle)
    } catch {
      setCanRestore(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!initiallyArchived) return
    void refresh()
  }, [initiallyArchived, refresh])

  useOnArchiveChange(refresh)

  if (!archived) return null

  const restore = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      await setProjectArchived(projectId, false)
      setArchived(false)
      announceArchiveChange()
      toast('Board restored')
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not restore this board')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm"
      style={{
        borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--primary) 10%, transparent)',
      }}
    >
      <Archive className="w-4 h-4 shrink-0 text-[var(--primary)]" />
      <span className="flex-1 min-w-0 text-white">
        This board is archived
        <span className="hidden sm:inline text-[var(--text-muted)]"> and hidden from everyone&apos;s dashboard.</span>
      </span>
      {canRestore && (
        <button
          type="button"
          onClick={restore}
          disabled={restoring}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60"
          style={{
            color: 'var(--primary)',
            borderColor: 'color-mix(in srgb, var(--primary) 45%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)',
          }}
        >
          {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Restore
        </button>
      )}
    </div>
  )
}
