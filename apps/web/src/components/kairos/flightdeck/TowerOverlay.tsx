'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { RadioTower, Square, X, WifiOff } from 'lucide-react'
import { killSessionAction, listSessionsAction } from '@/lib/actions/sessions'
import type { AgentSession } from '@/lib/db/schema'
import { formatCost, heartbeatStale } from '@/lib/flightdeck/timeline'
import { relativeTime, sessionElapsed, StatusDot } from './FlightDeckDrawer'

// Tower — mission control over every agent session the operator owns, across
// machines: status, runner, heartbeat freshness, engine, cost, duration.
// Display-only staleness: an unresponsive runner is flagged, never auto-failed.

const POLL_INTERVAL_MS = 4000
const STATUS_FILTERS = ['all', 'running', 'queued', 'succeeded', 'failed', 'killed'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export function TowerOverlay({
  open, onClose, onOpenSession,
}: {
  open: boolean
  onClose: () => void
  onOpenSession: (session: AgentSession) => void
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [now, setNow] = useState(() => Date.now())
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    try {
      setSessions(await listSessionsAction({ liveOnly: false, limit: 100, offset: 0 }) as AgentSession[])
    } catch { /* next poll */ }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    const t = setInterval(() => { void load(); setNow(Date.now()) }, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [open, load])

  // The overlay is a modal: Escape closes it like the backdrop click does.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const s of sessions) c.set(s.status, (c.get(s.status) ?? 0) + 1)
    return c
  }, [sessions])

  const visible = useMemo(
    () => (filter === 'all' ? sessions : sessions.filter((s) => s.status === filter)),
    [sessions, filter],
  )

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[190] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label="Tower — all missions"
            className="fixed inset-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[900px] md:inset-y-8 z-[191] rounded-2xl bg-[rgba(8,6,18,0.97)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
          >
            <header className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
              <RadioTower className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-[12px] uppercase tracking-[0.24em] text-white/70">Tower</span>
              <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                {STATUS_FILTERS.map((f) => {
                  const count = f === 'all' ? sessions.length : counts.get(f) ?? 0
                  const active = filter === f
                  const pulse = f === 'running' && count > 0
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${active
                        ? 'border-white/25 bg-white/[0.08] text-white/85'
                        : 'border-white/[0.06] text-white/40 hover:text-white/65 hover:border-white/15'
                        } ${pulse ? 'animate-pulse' : ''}`}
                    >
                      {f} {count > 0 && <span className="text-white/35">{count}</span>}
                    </button>
                  )
                })}
              </div>
              <button onClick={onClose} autoFocus aria-label="Close Tower" className="ml-auto p-1 rounded-md text-white/35 hover:text-white/85">
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="p-6 text-[12px] text-white/40">No missions{filter !== 'all' ? ` with status ${filter}` : ''}.</div>
              ) : (
                <ul>
                  {visible.map((s) => (
                    <TowerRow
                      key={s.id}
                      session={s}
                      now={now}
                      onOpen={() => onOpenSession(s)}
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
  )
}

function TowerRow({
  session, now, onOpen, onKilled,
}: {
  session: AgentSession
  now: number
  onOpen: () => void
  onKilled: () => void
}) {
  const live = session.status === 'running' || session.status === 'queued'
  const stale = session.status === 'running' && heartbeatStale(session.lastHeartbeatAt, now)
  const elapsed = sessionElapsed(session, now)
  const cost = session.costUsd ? Number(session.costUsd) : null

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="group px-5 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer focus:outline-none focus-visible:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2.5">
        <StatusDot status={session.status} />
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-[0.16em] font-medium shrink-0"
          style={{
            background: 'color-mix(in oklab, var(--primary) 16%, transparent)',
            color: 'color-mix(in oklab, var(--primary) 80%, white)',
          }}
        >
          {session.engine}
        </span>
        <span className="text-[12px] text-white/85 truncate flex-1">{session.goal}</span>
        {stale && (
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 uppercase tracking-[0.12em] shrink-0">
            <WifiOff className="w-2.5 h-2.5" /> unresponsive
          </span>
        )}
      </div>
      <div className="mt-1.5 ml-4 flex items-center gap-3 text-[10px] text-white/35">
        <span>{session.status}</span>
        {session.repo && <span className="font-mono">{session.repo}</span>}
        {session.claimedBy && <span className="font-mono text-white/45">{session.claimedBy}</span>}
        {elapsed && <span>{elapsed}</span>}
        {cost !== null && cost > 0 && <span className="font-mono text-white/50">{formatCost(cost)}</span>}
        <span className="ml-auto">{relativeTime(new Date(session.spawnedAt))}</span>
        {live && (
          <button
            onClick={async (e) => {
              e.stopPropagation()
              try { await killSessionAction(session.id) } catch (err) { console.error('[tower] kill failed', err) }
              onKilled()
            }}
            className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-rose-500/15 text-white/65 hover:text-rose-200 transition-opacity"
          >
            <Square className="w-2.5 h-2.5" /> Kill
          </button>
        )}
      </div>
    </li>
  )
}
