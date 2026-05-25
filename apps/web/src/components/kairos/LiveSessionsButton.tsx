'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, X, Square, Clock } from 'lucide-react'
import {
  listSessionsAction,
  killSessionAction,
  listSessionEventsAction,
} from '@/lib/actions/sessions'
import type { AgentSession, SessionEvent } from '@/lib/db/schema'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3 (D18) — Live sessions surface.
//
// Sidebar button shows a pulsing dot + count of live (queued/running)
// sessions Kairos has dispatched. Clicking opens a popover listing each
// session with engine + goal + relative time + kill button. Clicking a
// session opens a transcript panel that polls events every 2 seconds.
// ─────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 4000
const EVENT_POLL_INTERVAL_MS = 2000

export function LiveSessionsButton() {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [open, setOpen] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

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

  const liveCount = sessions.length

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  return (
    <>
      <div className="relative">
        <motion.button
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
                    <Bot className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">Live sessions</span>
                    {liveCount > 0 && (
                      <span className="text-[10px] text-white/30">{liveCount} running</span>
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
                          onOpen={() => { setActiveSessionId(s.id); setOpen(false) }}
                          onKilled={load}
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

      <SessionTranscriptDrawer
        session={activeSession}
        onClose={() => setActiveSessionId(null)}
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

function SessionTranscriptDrawer({
  session, onClose, onKilled,
}: {
  session: AgentSession | null
  onClose: () => void
  onKilled: () => void
}) {
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [loading, setLoading] = useState(false)

  const sessionId = session?.id ?? null

  const pollEvents = useCallback(async () => {
    if (!sessionId) return
    try {
      const lastSeq = events.length > 0 ? events[events.length - 1].seq : undefined
      const next = await listSessionEventsAction(sessionId, { afterSeq: lastSeq, limit: 200 })
      if (next.length > 0) setEvents((prev) => [...prev, ...(next as SessionEvent[])])
    } catch {
      // ignore
    }
  }, [sessionId, events])

  // Reset events when switching sessions.
  useEffect(() => {
    setEvents([])
    if (!sessionId) return
    setLoading(true)
    void (async () => {
      try {
        const initial = await listSessionEventsAction(sessionId, { limit: 200 })
        setEvents(initial as SessionEvent[])
      } finally {
        setLoading(false)
      }
    })()
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const t = setInterval(pollEvents, EVENT_POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [sessionId, pollEvents])

  return (
    <AnimatePresence>
      {session && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.22 }}
          className="fixed top-0 right-0 h-screen w-[480px] z-[200] bg-[rgba(8,6,18,0.97)] backdrop-blur-xl border-l border-white/[0.08] shadow-2xl flex flex-col"
        >
          <header className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Bot className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] uppercase tracking-[0.22em] text-white/65">
                {session.engine} · {session.status}
              </div>
              <div className="text-[13px] text-white/85 truncate">{session.goal}</div>
            </div>
            <button
              onClick={async () => { try { await killSessionAction(session.id) } catch {} ; onKilled() }}
              className="text-[10px] px-2 py-1 rounded-md bg-white/[0.04] hover:bg-rose-500/15 text-white/65 hover:text-rose-200 inline-flex items-center gap-1"
            >
              <Square className="w-2.5 h-2.5" /> Kill
            </button>
            <button onClick={onClose} className="p-1 rounded-md text-white/35 hover:text-white/85">
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-white/75 space-y-1.5">
            {loading && events.length === 0 ? (
              <div className="text-white/40">Loading transcript…</div>
            ) : events.length === 0 ? (
              <div className="text-white/40">Waiting for events…</div>
            ) : (
              events.map((e) => (
                <EventLine key={e.id} event={e} />
              ))
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function EventLine({ event }: { event: SessionEvent }) {
  const colour =
    event.kind === 'error' ? 'text-rose-300/85'
    : event.kind === 'stop' ? 'text-emerald-300/85'
    : event.kind === 'tool_use' || event.kind === 'tool_result' ? 'text-sky-300/80'
    : 'text-white/65'

  const detail = useMemo(() => extractEventDetail(event), [event])

  return (
    <div className={`leading-snug whitespace-pre-wrap break-words ${colour}`}>
      <span className="text-white/30 mr-2">#{event.seq}</span>
      <span className="text-white/40 mr-2">{event.kind}{event.toolName ? `:${event.toolName}` : ''}</span>
      <span>{detail}</span>
    </div>
  )
}

function extractEventDetail(event: SessionEvent): string {
  const p = event.payload as Record<string, unknown> | null
  if (!p) return ''
  if (typeof p.text === 'string') return (p.text as string).slice(0, 400)
  if (typeof p.message === 'string') return (p.message as string).slice(0, 400)
  try {
    return JSON.stringify(p).slice(0, 400)
  } catch {
    return ''
  }
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return d.toLocaleDateString()
}
