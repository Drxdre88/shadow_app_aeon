'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, ArrowRight, X } from 'lucide-react'
import Link from 'next/link'
import { getRecentAdvisories, archiveMemoryById } from '@/lib/actions/memories'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (E22) — Advisory feed.
//
// Ambient sidebar surface for Briefer-generated advisories. A small button
// shows the unread count; clicking opens a popover that lists the last
// few days of advisories. Each row offers Acknowledge (soft-archives the
// memory) and Open (deep-link to the Kairos graph node).
//
// "Unread" is purely client-side via localStorage — last-viewed timestamp.
// No new server state needed; tightening to true unread flags can come
// later if multi-device sync matters.
// ─────────────────────────────────────────────────────────────────────────

const LAST_VIEWED_KEY = 'kairos.advisoryFeed.lastViewed'
const POLL_INTERVAL_MS = 60_000 // gentle refresh while open

type Advisory = {
  id: string
  title: string
  bodyMd: string
  createdAt: Date | string
  dominionId: string | null
  dominionName: string | null
  dominionColor: string | null
}

function getLastViewed(): number {
  if (typeof window === 'undefined') return 0
  const raw = localStorage.getItem(LAST_VIEWED_KEY)
  return raw ? Number(raw) || 0 : 0
}

function setLastViewed(t: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LAST_VIEWED_KEY, String(t))
}

export function AdvisoryFeed() {
  const [advisories, setAdvisories] = useState<Advisory[]>([])
  const [open, setOpen] = useState(false)
  const [lastViewed, setLastViewedState] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => { setLastViewedState(getLastViewed()) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getRecentAdvisories({ days: 3, limit: 15 })
      setAdvisories(rows.map((r) => ({
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
      })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Light polling while the popover is open so newly-cron'd advisories surface.
  useEffect(() => {
    if (!open) return
    const t = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [open, load])

  const unread = useMemo(
    () => advisories.filter((a) => new Date(a.createdAt).getTime() > lastViewed).length,
    [advisories, lastViewed],
  )

  const handleOpen = () => {
    setOpen(true)
    const now = Date.now()
    setLastViewed(now)
    setLastViewedState(now)
  }

  const acknowledge = async (id: string) => {
    setAdvisories((prev) => prev.filter((a) => a.id !== id))
    try { await archiveMemoryById(id) } catch { /* swallow; UI already removed */ }
  }

  return (
    <div className="relative">
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={open ? () => setOpen(false) : handleOpen}
        title="Advisories"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Sparkles className="w-4 h-4" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-semibold rounded-full text-white"
            style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[170]"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[360px] sm:w-[400px] max-h-[480px] z-[171] rounded-2xl bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
            >
              <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                  <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">Advisories</span>
                  {advisories.length > 0 && (
                    <span className="text-[10px] text-white/30">{advisories.length} active</span>
                  )}
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto">
                {loading && advisories.length === 0 ? (
                  <div className="p-4 text-[12px] text-white/40">Loading…</div>
                ) : advisories.length === 0 ? (
                  <div className="p-5 text-[12px] text-white/40">
                    No advisories yet. The morning briefing creates one per active Dominion each day.
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {advisories.map((a) => (
                      <AdvisoryRow
                        key={a.id}
                        advisory={a}
                        unread={new Date(a.createdAt).getTime() > lastViewed}
                        onAcknowledge={() => acknowledge(a.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function AdvisoryRow({
  advisory, unread, onAcknowledge,
}: {
  advisory: Advisory
  unread: boolean
  onAcknowledge: () => void
}) {
  const preview = useMemo(() => extractPreview(advisory.bodyMd), [advisory.bodyMd])
  const when = useMemo(() => relativeTime(new Date(advisory.createdAt)), [advisory.createdAt])

  return (
    <li className={`group px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] ${unread ? 'bg-white/[0.015]' : ''}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {advisory.dominionName && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-[0.16em] font-medium"
            style={{
              background: `color-mix(in oklab, var(--${advisory.dominionColor ?? 'primary'}, var(--primary)) 16%, transparent)`,
              color: `color-mix(in oklab, var(--${advisory.dominionColor ?? 'primary'}, var(--primary)) 80%, white)`,
            }}
          >
            {advisory.dominionName}
          </span>
        )}
        {unread && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--primary)', boxShadow: '0 0 6px var(--primary)' }}
          />
        )}
        <span className="text-[10px] text-white/30 ml-auto">{when}</span>
      </div>
      <div className="text-[12px] text-white/80 leading-relaxed line-clamp-3">{preview}</div>
      <div className="mt-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link
          href={`/kairos?focus=${advisory.id}`}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.10] text-white/65 hover:text-white/95"
        >
          Open <ArrowRight className="w-2.5 h-2.5" />
        </Link>
        <button
          onClick={onAcknowledge}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-emerald-500/15 text-white/65 hover:text-emerald-200"
        >
          <Check className="w-2.5 h-2.5" /> Acknowledge
        </button>
      </div>
    </li>
  )
}

function extractPreview(markdown: string): string {
  // Briefer output starts with "## State" — pull that section's first
  // paragraph for the row preview. Falls back to first non-heading line.
  const lines = markdown.split('\n')
  let inState = false
  const buf: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (inState && buf.length > 0) break
      continue
    }
    if (line.startsWith('## ')) {
      if (line.toLowerCase().includes('state')) { inState = true; continue }
      if (inState) break
      continue
    }
    if (line.startsWith('#')) continue
    if (inState) buf.push(line)
    else if (buf.length === 0 && !line.startsWith('*')) buf.push(line)
  }
  const text = buf.join(' ').replace(/\*\*/g, '')
  return text.length > 280 ? text.slice(0, 277) + '…' : text || '(no preview)'
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
