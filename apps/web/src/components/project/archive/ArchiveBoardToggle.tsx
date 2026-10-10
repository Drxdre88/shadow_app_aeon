'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { toast } from '@/components/ui/Toast'
import { getProjectArchiveSetting, setProjectArchived } from '@/lib/actions/project-archive'
import { ArchiveConfirm } from './ArchiveConfirm'
import { archiveExplainer, ARCHIVE_OWNER_ONLY, announceArchiveChange } from './archive-events'
import { useVorath } from '@/hooks/useVorath'

interface ArchiveBoardToggleProps {
  projectId: string
  projectName: string
  isOpen: boolean
  onArchived?: () => void
}

type ArchiveState = { archived: boolean; canToggle: boolean }

/**
 * Board settings switch for "Archive board". Saves at once through its own
 * creator-only action; members see it locked with the reason.
 */
export function ArchiveBoardToggle({ projectId, projectName, isOpen, onArchived }: ArchiveBoardToggleProps) {
  const router = useRouter()
  const [state, setState] = useState<ArchiveState | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const explainer = archiveExplainer(useVorath())

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getProjectArchiveSetting(projectId)
      .then((s) => { if (!cancelled) setState({ archived: s.archived, canToggle: s.canToggle }) })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [isOpen, projectId])

  if (!state) return null
  const locked = !state.canToggle

  const save = async (next: boolean) => {
    setSaving(true)
    setState({ ...state, archived: next })
    try {
      await setProjectArchived(projectId, next)
      announceArchiveChange()
      if (next) {
        onArchived?.()
        router.push('/dashboard')
      }
      router.refresh()
    } catch (err) {
      setState({ ...state, archived: !next })
      toast(err instanceof Error ? err.message : 'Could not change the archive setting')
    } finally {
      setSaving(false)
    }
  }

  const onToggle = () => {
    if (saving || locked) return
    if (state.archived) void save(false)
    else setConfirming(true)
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={saving || locked}
        className={cn('w-full flex items-center justify-between gap-3 disabled:opacity-70', locked && 'cursor-not-allowed')}
        aria-pressed={state.archived}
        title={locked ? ARCHIVE_OWNER_ONLY : undefined}
      >
        <span className="flex items-center gap-2 min-w-0 text-left">
          <Archive className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
          <span>
            <span className="block text-sm text-white">Archive board</span>
            <span className="block text-[10px] text-slate-500">
              {locked ? ARCHIVE_OWNER_ONLY : explainer}
            </span>
          </span>
        </span>
        <span
          className={cn(
            'w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
            state.archived ? 'bg-[var(--primary)]/70' : 'bg-white/15'
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              state.archived ? 'translate-x-[18px]' : 'translate-x-0.5'
            )}
          />
        </span>
      </button>
      <ArchiveConfirm
        boardName={confirming ? projectName : null}
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); void save(true) }}
      />
    </div>
  )
}
