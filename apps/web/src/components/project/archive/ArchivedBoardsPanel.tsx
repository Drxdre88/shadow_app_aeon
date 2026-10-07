'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Archive, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { setProjectArchived } from '@/lib/actions/project-archive'
import type { ArchivedProjectView } from '@/lib/projects/archive'
import type { ArchivedBoardsStatus } from './useArchivedBoards'
import { announceArchiveChange } from './archive-events'

interface ArchivedBoardsPanelProps {
  isOpen: boolean
  onClose: () => void
  boards: ArchivedProjectView[]
  status: ArchivedBoardsStatus
  onRetry: () => void
}

function archivedOn(at: string | null): string | null {
  if (!at) return null
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Every archived board the viewer can reach, each one a click from opening or restoring. */
export function ArchivedBoardsPanel({ isOpen, onClose, boards, status, onRetry }: ArchivedBoardsPanelProps) {
  const mounted = useHasMounted()
  const router = useRouter()
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!mounted || !isOpen) return null

  const restore = async (board: ArchivedProjectView) => {
    if (restoringId) return
    setRestoringId(board.id)
    try {
      await setProjectArchived(board.id, false)
      announceArchiveChange()
      toast(`"${board.name}" restored`)
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not restore this board')
    } finally {
      setRestoringId(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        role="dialog"
        aria-label="Archived boards"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--background) 96%, transparent)',
          borderColor: 'var(--border)',
          boxShadow: '0 0 40px color-mix(in srgb, var(--primary) 18%, transparent)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Archive className="w-4 h-4 text-[var(--primary)]" />
            <h2 className="text-base font-semibold text-white">Archived boards</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {status === 'loading' && boards.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading archived boards
            </div>
          )}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-[var(--text-muted)]">
              Could not load archived boards.
              <button type="button" onClick={onRetry} className="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/15 transition-colors">
                Try again
              </button>
            </div>
          )}
          {status === 'ready' && boards.length === 0 && (
            <p className="py-10 text-center text-sm text-[var(--text-dim)]">No archived boards. Restored boards are back on the dashboard.</p>
          )}
          {status !== 'error' && boards.map((board) => {
            const when = archivedOn(board.archivedAt)
            const busy = restoringId === board.id
            return (
              <div key={board.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.06] last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{board.name}</p>
                  {when && <p className="text-[10px] text-[var(--text-dim)]">Archived {when}</p>}
                </div>
                <Link
                  href={`/project/${board.id}`}
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </Link>
                <button
                  type="button"
                  onClick={() => restore(board)}
                  disabled={!!restoringId}
                  aria-label={`Restore ${board.name}`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60"
                  style={{
                    color: 'var(--primary)',
                    borderColor: 'color-mix(in srgb, var(--primary) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                  }}
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Restore
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
