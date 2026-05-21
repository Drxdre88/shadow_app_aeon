'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createMemory } from '@/lib/actions/memories'

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function QuickCaptureOverlay() {
  const mounted = useHasMounted()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const openOverlay = useCallback(() => {
    setOpen(true)
    setStatus('idle')
    setErrorMsg(null)
  }, [])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    setText('')
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
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

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
      })
      setStatus('saved')
      setText('')
      setTimeout(() => {
        closeOverlay()
      }, 600)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save memory')
    }
  }, [text, status, closeOverlay])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

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
          className="fixed inset-0 z-[400] flex items-start justify-center pt-[18vh] bg-black/55 backdrop-blur-md"
          onClick={closeOverlay}
        >
          <motion.div
            initial={{ y: -16, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[min(640px,92vw)] rounded-2xl border border-white/10 bg-[rgba(14,12,22,0.92)] shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
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
              className="w-full resize-none bg-transparent px-4 py-4 text-sm text-white/90 placeholder:text-white/30 outline-none"
              rows={6}
              disabled={status === 'saving'}
            />

            <div className="flex items-center justify-between px-4 pb-3 pt-1 text-[11px] text-white/40">
              <div className="flex items-center gap-3">
                <span>⌘⏎ / Ctrl+⏎ save</span>
                <span className="text-white/20">•</span>
                <span>Esc close</span>
              </div>
              <div className="flex items-center gap-2">
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
