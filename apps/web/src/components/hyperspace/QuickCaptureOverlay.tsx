'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Mic, Anchor } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createMemory, listMemoriesForUser } from '@/lib/actions/memories'
import { useSidebarStore } from '@/stores/sidebarStore'

type Status = 'idle' | 'saving' | 'saved' | 'error'
type AnchorMode = 'none' | 'project' | 'realm'

type RecentMemory = {
  id: string
  title: string
  createdAt: Date | string
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function QuickCaptureOverlay() {
  const mounted = useHasMounted()
  const pathname = usePathname()
  const activeRealmId = useSidebarStore((s) => s.activeRealmId)

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [anchor, setAnchor] = useState<AnchorMode>('none')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [recentTags, setRecentTags] = useState<string[]>([])
  const [recentCaptures, setRecentCaptures] = useState<RecentMemory[]>([])
  const [voiceHint, setVoiceHint] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currentProjectId = useMemo(() => {
    if (!pathname?.startsWith('/project/')) return null
    const seg = pathname.split('/')[2] ?? ''
    return UUID_RE.test(seg) ? seg : null
  }, [pathname])

  const openOverlay = useCallback(() => {
    setOpen(true)
    setStatus('idle')
    setErrorMsg(null)
  }, [])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    setText('')
    setTags([])
    setAnchor('none')
    setVoiceHint(false)
    setStatus('idle')
    setErrorMsg(null)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCaptureHotkey =
        (e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ')
      if (isCaptureHotkey) {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        closeOverlay()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, closeOverlay])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => textareaRef.current?.focus())
    // Lazy-load recent tags + captures the first time the overlay opens.
    listMemoriesForUser({ limit: 30 })
      .then((rows) => {
        const seen = new Set<string>()
        const distinct: string[] = []
        for (const r of rows) {
          for (const t of (r.tags ?? []) as string[]) {
            if (!seen.has(t)) { seen.add(t); distinct.push(t) }
            if (distinct.length >= 12) break
          }
          if (distinct.length >= 12) break
        }
        setRecentTags(distinct)
        setRecentCaptures(rows.slice(0, 3).map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt })))
      })
      .catch(() => { /* non-fatal */ })
  }, [open])

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  const submit = useCallback(async () => {
    const body = text.trim()
    if (!body || status === 'saving') return
    const firstLine = body.split('\n', 1)[0]
    const title = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine

    setStatus('saving')
    setErrorMsg(null)
    try {
      await createMemory({
        title,
        bodyMd: body,
        source: 'manual',
        type: 'note',
        tags: tags.length > 0 ? tags : undefined,
        realmId: anchor === 'realm' ? activeRealmId ?? undefined : undefined,
        projectId: anchor === 'project' ? currentProjectId ?? undefined : undefined,
      })
      setStatus('saved')
      setText('')
      setTags([])
      setTimeout(() => closeOverlay(), 600)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save memory')
    }
  }, [text, tags, anchor, activeRealmId, currentProjectId, status, closeOverlay])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const realmAnchorDisabled = !activeRealmId
  const projectAnchorDisabled = !currentProjectId

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="quick-capture-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[400] flex items-start justify-center pt-[14vh] bg-black/55 backdrop-blur-md"
          onClick={closeOverlay}
        >
          <motion.div
            initial={{ y: -16, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[min(640px,92vw)] rounded-2xl border border-white/10 bg-[rgba(14,12,22,0.92)] shadow-[0_20px_80px_rgba(0,0,0,0.6)] flex flex-col"
            style={{
              backdropFilter: 'blur(18px)',
              boxShadow:
                '0 0 0 1px rgba(139,92,246,0.18), 0 30px 90px rgba(0,0,0,0.55), 0 0 60px rgba(139,92,246,0.18)',
            }}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 text-white/70">
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span className="text-xs font-semibold tracking-[0.2em] uppercase">Quick capture</span>
              </div>
              <button
                onClick={closeOverlay}
                className="text-white/40 hover:text-white/80 transition-colors p-1 rounded-md hover:bg-white/[0.06]"
                aria-label="Close quick capture"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="What's on your mind?  (first line becomes the title)"
              className="w-full resize-none bg-transparent px-4 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none"
              rows={5}
              disabled={status === 'saving'}
            />

            {recentTags.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/30 self-center mr-1">Tags</span>
                {recentTags.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTag(t)}
                      className={`text-[10.5px] px-1.5 py-0.5 rounded transition-colors ${
                        on
                          ? 'bg-white/[0.16] text-white/90'
                          : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.10] hover:text-white/80'
                      }`}
                    >
                      #{t}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex items-center gap-2 px-4 pb-2">
              <Anchor className="w-3 h-3 text-white/30" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">Anchor</span>
              <AnchorOption active={anchor === 'none'} onClick={() => setAnchor('none')}>None</AnchorOption>
              <AnchorOption
                active={anchor === 'project'}
                disabled={projectAnchorDisabled}
                onClick={() => !projectAnchorDisabled && setAnchor('project')}
              >
                Current project
              </AnchorOption>
              <AnchorOption
                active={anchor === 'realm'}
                disabled={realmAnchorDisabled}
                onClick={() => !realmAnchorDisabled && setAnchor('realm')}
              >
                Current realm
              </AnchorOption>
            </div>

            {recentCaptures.length > 0 && (
              <div className="px-4 pb-2 border-t border-white/[0.04] pt-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 mb-1">Recent</div>
                <ul className="flex flex-col gap-0.5">
                  {recentCaptures.map((r) => (
                    <li key={r.id} className="text-[11px] text-white/45 truncate">
                      <span className="text-white/65">{r.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between px-4 pb-3 pt-1 text-[11px] text-white/40 border-t border-white/[0.04]">
              <div className="flex items-center gap-3">
                <span>⌘⏎ save</span>
                <span className="text-white/20">•</span>
                <span>Esc close</span>
                {voiceHint && <span className="text-white/55 italic">Voice coming soon.</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVoiceHint((v) => !v)}
                  className="p-1.5 rounded-md text-white/35 hover:text-white/80 hover:bg-white/[0.06]"
                  title="Voice capture (coming soon)"
                  aria-label="Voice capture"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
                {status === 'saving' && <span className="text-white/60">Saving…</span>}
                {status === 'saved' && <span className="text-emerald-400">Saved ✓</span>}
                {status === 'error' && (
                  <span className="text-rose-400" title={errorMsg ?? undefined}>
                    {errorMsg ?? 'Error'}
                  </span>
                )}
                <button
                  onClick={submit}
                  disabled={status === 'saving' || text.trim().length === 0}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] text-white/80 hover:text-white text-[11px] font-semibold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function AnchorOption({
  active, disabled, onClick, children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[10.5px] px-1.5 py-0.5 rounded transition-colors ${
        active
          ? 'bg-white/[0.16] text-white/90'
          : disabled
          ? 'text-white/20 cursor-not-allowed'
          : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.10] hover:text-white/85'
      }`}
    >
      {children}
    </button>
  )
}
