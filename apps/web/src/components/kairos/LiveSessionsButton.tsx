'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, X, Square, Clock, RadioTower } from 'lucide-react'
import { listSessionsAction, killSessionAction } from '@/lib/actions/sessions'
import type { AgentSession } from '@/lib/db/schema'
import { FlightDeckDrawer, relativeTime } from './flightdeck/FlightDeckDrawer'
import { TowerOverlay } from './flightdeck/TowerOverlay'

// ─────────────────────────────────────────────────────────────────────────
// Live sessions surface. Sidebar button shows a pulsing dot + count of live
// (queued/running) sessions. The popover lists them; a session opens the
// Flight Deck transcript drawer, and the Tower button opens mission control
// over every session across machines.
// ─────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 4000

export function LiveSessionsButton() {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [open, setOpen] = useState(false)
  const [towerOpen, setTowerOpen] = useState(false)
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null)
  const [mounted, setMounted] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    try {
      const rows = await listSessionsAction({ liveOnly: true, limit: 20, offset: 0 })
      setSessions(rows as AgentSession[])
    } catch {
      // swallow — sidebar should never break the shell
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Background poll for live count, even when popover is closed.
  useEffect(() => {
    const t = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  const measureAnchor = useCallback(() => {
    const el = buttonRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    if (!open) return
    measureAnchor()
    window.addEventListener('resize', measureAnchor)
    window.addEventListener('scroll', measureAnchor, true)
    return () => {
      window.removeEventListener('resize', measureAnchor)
      window.removeEventListener('scroll', measureAnchor, true)
    }
  }, [open, measureAnchor])

  const liveCount = sessions.length

  // Keep the drawer's session row fresh while it is open (status flips,
  // cost lands) without re-opening it.
  const activeSessionLive = useMemo(
    () => (activeSession ? sessions.find((s) => s.id === activeSession.id) ?? activeSession : null),
    [sessions, activeSession],
  )

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={open ? () => setOpen(false) : () => setOpen(true)}
        title="Live sessions"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Bot className="w-4 h-4" />
        {liveCount > 0 && (
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-semibold rounded-full text-white"
            style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}
          >
            {liveCount > 9 ? '9+' : liveCount}
          </motion.span>
        )}
      </motion.button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && anchor && (
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
                style={{
                  position: 'fixed',
                  bottom: typeof window !== 'undefined' ? window.innerHeight - anchor.top + 8 : 0,
                  left: Math.max(8, anchor.left),
                  width: 'min(400px, calc(100vw - 16px))',
                  maxHeight: 480,
                  zIndex: 171,
                }}
                className="rounded-2xl bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
              >
                <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">Live sessions</span>
                    {liveCount > 0 && (
                      <span className="text-[10px] text-white/30">{liveCount} running</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setTowerOpen(true); setOpen(false) }}
                      title="Open Tower — all missions"
                      className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06] inline-flex items-center gap-1"
                    >
                      <RadioTower className="w-3.5 h-3.5" />
                      <span className="text-[9px] uppercase tracking-[0.16em]">Tower</span>
                    </button>
                    <button
                      onClick={() => setOpen(false)}
                      className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto">
                  {sessions.length === 0 ? (
                    <div className="p-5 text-[12px] text-white/40">
                      No live sessions. Spawn one from the briefing or via <code className="text-white/60">spawn_session</code>.
                    </div>
                  ) : (
                    <ul className="flex flex-col">
                      {sessions.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          onOpen={() => { setActiveSession(s); setOpen(false) }}
                          onKilled={load}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <TowerOverlay
        open={towerOpen}
        onClose={() => setTowerOpen(false)}
        onOpenSession={(s) => { setActiveSession(s); setTowerOpen(false) }}
      />

      <FlightDeckDrawer
        session={activeSessionLive}
        onClose={() => setActiveSession(null)}
        onKilled={load}
      />
    </>
  )
}

function SessionRow({
  session, onOpen, onKilled,
}: {
  session: AgentSession
  onOpen: () => void
  onKilled: () => void
}) {
  const when = useMemo(() => relativeTime(new Date(session.spawnedAt)), [session.spawnedAt])
  const kill = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await killSessionAction(session.id) } catch { /* ignore */ }
    onKilled()
  }

  return (
    <li className="group px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer" onClick={onOpen}>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-[0.16em] font-medium"
          style={{
            background: `color-mix(in oklab, var(--primary) 16%, transparent)`,
            color: `color-mix(in oklab, var(--primary) 80%, white)`,
          }}
        >
          {session.engine}
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{
            background: session.status === 'running' ? '#34d399' : 'var(--primary)',
            boxShadow: '0 0 6px currentColor',
          }}
        />
        <span className="text-[10px] text-white/40">{session.status}</span>
        <span className="text-[10px] text-white/30 ml-auto flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {when}
        </span>
      </div>
      <div className="text-[12px] text-white/80 leading-relaxed line-clamp-2">{session.goal}</div>
      <div className="mt-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={kill}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-rose-500/15 text-white/65 hover:text-rose-200"
        >
          <Square className="w-2.5 h-2.5" /> Kill
        </button>
      </div>
    </li>
  )
}
