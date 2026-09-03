'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Brain, ChevronDown, ChevronRight, Check, FileText, Globe,
  Pencil, Plug, Search, Square, Terminal, Wrench, X, AlertTriangle,
} from 'lucide-react'
import { getSessionAction, killSessionAction, listSessionEventsAction } from '@/lib/actions/sessions'
import type { AgentSession, SessionEvent } from '@/lib/db/schema'
import {
  addUsage, buildTimeline, emptyTotals, formatCost, formatDuration, formatTokens,
  type LiveTotals, type MissionStats, type TimelineItem, type ToolClass, type ToolItem,
} from '@/lib/flightdeck/timeline'

// Flight Deck transcript drawer — the typed mission timeline. Renders the
// parsed event stream (tool chips, collapsible thinking, subagent nesting,
// live telemetry strip) and degrades to raw text for legacy sessions.

const EVENT_POLL_INTERVAL_MS = 2000
const EVENT_PAGE = 500
// Client-side retention bound: a very long mission must not grow the events
// array (and the rendered DOM) without limit.
const EVENT_RETENTION = 2000
const LIVE_STATUSES = new Set(['queued', 'running'])
// A live mission that goes quiet re-reads its session row every Nth empty
// poll: a kill or timeout without a stop/result event is only visible there.
const ROW_REFRESH_EVERY_EMPTY_POLLS = 5

const TOOL_ICONS: Record<ToolClass, typeof Terminal> = {
  bash: Terminal, read: FileText, search: Search, edit: Pencil,
  subagent: Bot, mcp: Plug, web: Globe, other: Wrench,
}

// First string value out of the JSON input summary — the chip's one-liner.
function inputSnippet(input: string): string {
  if (!input) return ''
  try {
    const parsed: unknown = JSON.parse(input)
    if (parsed && typeof parsed === 'object') {
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) return value.slice(0, 80)
      }
    }
  } catch { /* raw fallback below */ }
  return input.slice(0, 80)
}

export function FlightDeckDrawer({
  session, onClose, onKilled,
}: {
  session: AgentSession | null
  onClose: () => void
  onKilled: () => void
}) {
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [loading, setLoading] = useState(false)
  // The prop can go stale (a finished mission drops off the live list); the
  // drawer keeps its own fresh row for header status / cost / elapsed.
  const [sessionRow, setSessionRow] = useState<AgentSession | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)
  // The tail cursor lives in a ref, not derived from state: an overlapping
  // fetch would otherwise re-read the same window and double-append (dup keys,
  // doubled usage totals).
  const lastSeqRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)
  // Which mission the refs belong to. A fetch that resolves after the reader
  // switched missions in the Tower must be dropped: its rows would splice into
  // the new transcript and its max seq would poison the cursor.
  const sessionIdRef = useRef<string | null>(null)
  // Every event id appended for this mission. Dedupe is on the globally
  // unique id (seqs repeat across missions), and each usage event feeds the
  // running totals exactly once — so evicting old rows past the retention
  // bound can never make the token strip run backwards.
  const seenIdsRef = useRef<Set<string>>(new Set())
  const totalsRef = useRef<LiveTotals>(emptyTotals())
  const [liveTotals, setLiveTotals] = useState<LiveTotals>(emptyTotals)
  const emptyPollsRef = useRef(0)
  // Set when a finished mission was seeded from its tail on open, so the
  // terminal effect does not immediately repeat the same two reads.
  const seededFinishedRef = useRef(false)

  const sessionId = session?.id ?? null
  const current = (sessionRow && sessionRow.id === sessionId ? sessionRow : null) ?? session
  const isLive = current ? LIVE_STATUSES.has(current.status) : false
  const knownFinished = current !== null && !isLive

  const appendEvents = useCallback((next: SessionEvent[], forSessionId: string) => {
    if (next.length === 0 || forSessionId !== sessionIdRef.current) return
    const seen = seenIdsRef.current
    const fresh = next.filter((e) => !seen.has(e.id))
    if (fresh.length === 0) return
    for (const e of fresh) {
      seen.add(e.id)
      if (e.kind === 'usage') addUsage(totalsRef.current, (e.payload ?? {}) as Record<string, unknown>)
    }
    lastSeqRef.current = fresh.reduce((max, e) => Math.max(max, e.seq), lastSeqRef.current ?? -1)
    setLiveTotals({ ...totalsRef.current })
    setEvents((prev) => {
      // Sort, don't append: a terminal re-drain can deliver lower seqs than
      // the cursor (late-landing runner chunks) and they must render in order.
      const merged = [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
      return merged.length > EVENT_RETENTION ? merged.slice(-EVENT_RETENTION) : merged
    })
  }, [])

  useEffect(() => {
    sessionIdRef.current = sessionId
    seenIdsRef.current = new Set()
    totalsRef.current = emptyTotals()
    seededFinishedRef.current = false
    setLiveTotals(emptyTotals())
    setEvents([])
    setSessionRow(null)
    emptyPollsRef.current = 0
    lastSeqRef.current = undefined
    inFlightRef.current = false
    if (!sessionId) return
    let cancelled = false
    setLoading(true)
    inFlightRef.current = true
    void (async () => {
      try {
        const row = await getSessionAction(sessionId) as AgentSession
        if (cancelled) return
        setSessionRow(row)
        if (LIVE_STATUSES.has(row.status)) {
          // Live: walk forward so the poll cursor continues seamlessly.
          for (let page = 0; page < 6; page++) {
            const rows = await listSessionEventsAction(sessionId, { afterSeq: lastSeqRef.current, limit: EVENT_PAGE }) as SessionEvent[]
            if (cancelled) return
            appendEvents(rows, sessionId)
            if (rows.length < EVENT_PAGE) break
          }
        } else {
          // Finished: seed from the END — the result card is the point, and a
          // forward walk can never reach it on a long transcript.
          const rows = await listSessionEventsAction(sessionId, { tail: true, limit: EVENT_PAGE }) as SessionEvent[]
          if (cancelled) return
          seededFinishedRef.current = true
          appendEvents(rows, sessionId)
        }
      } catch { /* header falls back to the prop */ } finally {
        if (!cancelled) {
          setLoading(false)
          inFlightRef.current = false
        }
      }
    })()
    return () => { cancelled = true }
  }, [sessionId, appendEvents])

  const pollEvents = useCallback(async () => {
    const id = sessionId
    if (!id || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const next = await listSessionEventsAction(id, { afterSeq: lastSeqRef.current, limit: EVENT_PAGE }) as SessionEvent[]
      appendEvents(next, id)
      if (next.length > 0) {
        emptyPollsRef.current = 0
      } else {
        emptyPollsRef.current += 1
        if (emptyPollsRef.current % ROW_REFRESH_EVERY_EMPTY_POLLS === 0) {
          const row = await getSessionAction(id) as AgentSession
          if (sessionIdRef.current === id) setSessionRow(row)
        }
      }
    } catch { /* poll again next tick */ } finally {
      if (sessionIdRef.current === id) inFlightRef.current = false
    }
  }, [sessionId, appendEvents])

  // Terminal by events (stop/result landed) OR by status (the row says the
  // mission is over): either way no tool is still running and polling stops.
  const timeline = useMemo(() => buildTimeline(events, { forceTerminal: knownFinished }), [events, knownFinished])

  useEffect(() => {
    if (!sessionId || timeline.terminal) return
    const t = setInterval(pollEvents, EVENT_POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [sessionId, timeline.terminal, pollEvents])

  // When the mission ends: refresh the session row (status flip, final cost)
  // AND re-read the tail — sequentially-chunked runner flushes can land rows
  // with LOWER seqs after the result event, which a forward cursor would skip
  // forever. One extra round-trip, at the only moment it matters.
  useEffect(() => {
    if (!sessionId || !timeline.terminal) return
    // Opened already finished: the seed effect just did exactly these reads.
    if (seededFinishedRef.current) { seededFinishedRef.current = false; return }
    const drain = (): void => {
      listSessionEventsAction(sessionId, { tail: true, limit: EVENT_PAGE })
        .then((rows) => appendEvents(rows as SessionEvent[], sessionId))
        .catch(() => { })
    }
    getSessionAction(sessionId)
      .then((row) => { if (sessionIdRef.current === sessionId) setSessionRow(row as AgentSession) })
      .catch(() => { })
    drain()
    // A runner chunk can still be retrying for ~13s after the result lands —
    // sweep once more after that window.
    const t = setTimeout(drain, 15_000)
    return () => clearTimeout(t)
  }, [sessionId, timeline.terminal, appendEvents])

  // Follow the stream only while the reader is at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight
  }, [events])

  const view = current

  return (
    <AnimatePresence>
      {view && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.22 }}
          className="fixed top-0 right-0 h-screen w-[560px] max-w-full z-[200] bg-[rgba(8,6,18,0.97)] backdrop-blur-xl border-l border-white/[0.08] shadow-2xl flex flex-col"
        >
          <header className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Bot className="w-4 h-4 shrink-0" style={{ color: 'var(--primary)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/65 flex items-center gap-2">
                {view.engine} · {view.status}
                {timeline.stats?.model && (
                  <span className="normal-case tracking-normal text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">
                    {timeline.stats.model}
                  </span>
                )}
              </div>
              <div className="text-[13px] text-white/85 truncate">{view.goal}</div>
            </div>
            {isLive && (
              <button
                onClick={async () => {
                  try { await killSessionAction(view.id) } catch (err) { console.error('[flightdeck] kill failed', err) }
                  onKilled()
                }}
                className="text-[10px] px-2 py-1 rounded-md bg-white/[0.04] hover:bg-rose-500/15 text-white/65 hover:text-rose-200 inline-flex items-center gap-1"
              >
                <Square className="w-2.5 h-2.5" /> Kill
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded-md text-white/35 hover:text-white/85">
              <X className="w-4 h-4" />
            </button>
          </header>

          <TelemetryStrip session={view} stats={timeline.stats} totals={liveTotals} live={isLive} />

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            }}
            className="flex-1 overflow-y-auto p-4 space-y-2"
          >
            {loading && events.length === 0 ? (
              <div className="text-[12px] text-white/40">Loading transcript…</div>
            ) : timeline.items.length === 0 ? (
              <div className="text-[12px] text-white/40">Waiting for events…</div>
            ) : (
              timeline.items.map((item) => <TimelineRow key={item.seq} item={item} />)
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function TelemetryStrip({
  session, stats, totals, live,
}: {
  session: AgentSession
  stats: MissionStats | null
  totals: LiveTotals
  live: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])

  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : null
  const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : null
  const durationMs = stats?.durationMs
    ?? (startedAt ? ((endedAt ?? now) - startedAt) : null)

  const cost = stats?.totalCostUsd ?? (session.costUsd ? Number(session.costUsd) : null)
  const inTokens = stats?.inputTokens !== undefined
    ? (stats.inputTokens ?? 0) + (stats.cacheReadTokens ?? 0) + (stats.cacheCreationTokens ?? 0)
    : totals.inputTokens + totals.cacheReadTokens + totals.cacheCreationTokens
  const outTokens = stats?.outputTokens ?? totals.outputTokens

  const cells: Array<[label: string, value: string]> = []
  if (durationMs !== null && durationMs > 0) cells.push(['time', formatDuration(durationMs)])
  if (inTokens > 0) cells.push(['tok in', formatTokens(inTokens)])
  if (outTokens > 0) cells.push(['tok out', formatTokens(outTokens)])
  if (stats?.toolCalls) cells.push(['tools', String(stats.toolCalls)])
  if (cost !== null && cost > 0) cells.push(['cost', formatCost(cost)])
  if (cells.length === 0) return null

  return (
    <div className="px-4 py-2 border-b border-white/[0.05] flex items-center gap-4 text-[10px]">
      {live && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
          style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }}
        />
      )}
      {cells.map(([label, value]) => (
        <span key={label} className="flex items-baseline gap-1.5">
          <span className="uppercase tracking-[0.16em] text-white/30">{label}</span>
          <span className="font-mono text-white/75">{value}</span>
        </span>
      ))}
    </div>
  )
}

function TimelineRow({ item, nested = false }: { item: TimelineItem; nested?: boolean }) {
  switch (item.type) {
    case 'init':
      return (
        <div className="text-[10px] text-white/35 flex items-center gap-2 py-0.5">
          <span className="uppercase tracking-[0.18em]">session</span>
          {item.model && <span className="font-mono text-white/55">{item.model}</span>}
          {item.permissionMode && <span>{item.permissionMode}</span>}
          {item.toolCount !== null && <span>{item.toolCount} tools</span>}
          {item.version && <span>v{item.version}</span>}
        </div>
      )
    case 'thinking':
      return <ThinkingRow text={item.text} />
    case 'text':
      return (
        <div className="text-[12px] text-white/85 leading-relaxed whitespace-pre-wrap break-words">
          {item.text}
        </div>
      )
    case 'raw':
      return (
        <div className="text-[10px] font-mono text-white/30 whitespace-pre-wrap break-words leading-snug">
          {item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text}
        </div>
      )
    case 'error':
      return (
        <div className="text-[11px] font-mono text-rose-300/85 whitespace-pre-wrap break-words flex gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{item.message.length > 600 ? `${item.message.slice(0, 600)}…` : item.message}</span>
        </div>
      )
    case 'stop':
      return (
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 border-t border-white/[0.05] pt-2">
          process exited{item.exitCode !== null ? ` (code ${item.exitCode})` : ''}
        </div>
      )
    case 'result':
      return <ResultCard item={item} />
    case 'tool':
      return <ToolRow tool={item} nested={nested} />
  }
}

function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-white/35 hover:text-white/60 italic"
      >
        <Brain className="w-3 h-3" />
        thinking
        {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
      </button>
      {open && (
        <div className="mt-1 ml-4 pl-2 border-l border-white/[0.08] text-[11px] text-white/45 italic whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  )
}

function ToolRow({ tool, nested }: { tool: ToolItem; nested: boolean }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[tool.toolClass]
  const snippet = inputSnippet(tool.input)

  return (
    <div className={nested ? 'ml-4 pl-2 border-l border-white/[0.06]' : ''}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] text-left"
        style={tool.running ? { boxShadow: '0 0 10px color-mix(in oklab, var(--primary) 35%, transparent)' } : undefined}
      >
        {tool.running ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
            className="shrink-0"
          >
            <Icon className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
          </motion.span>
        ) : (
          <Icon className="w-3.5 h-3.5 shrink-0 text-white/45" />
        )}
        <span className="font-mono text-[11px] text-white/80 shrink-0">{tool.toolName}</span>
        {snippet && <span className="text-[10px] text-white/40 truncate flex-1">{snippet}</span>}
        <span className="ml-auto shrink-0">
          {tool.running ? (
            <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--primary)' }}>running</span>
          ) : tool.result?.isError ? (
            <X className="w-3 h-3 text-rose-400" />
          ) : (
            <Check className="w-3 h-3 text-emerald-400/70" />
          )}
        </span>
      </button>

      {open && (
        <div className="mt-1 ml-6 space-y-1.5">
          {tool.input && (
            <pre className="text-[10px] font-mono text-white/50 bg-white/[0.02] rounded-md p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {tool.input}
            </pre>
          )}
          {tool.result?.content && (
            <pre className={`text-[10px] font-mono rounded-md p-2 whitespace-pre-wrap break-words max-h-56 overflow-y-auto ${tool.result.isError ? 'text-rose-300/75 bg-rose-500/[0.05]' : 'text-white/55 bg-white/[0.02]'}`}>
              {tool.result.content}
            </pre>
          )}
        </div>
      )}

      {tool.children.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {tool.children.map((child) => <TimelineRow key={child.seq} item={child} nested />)}
        </div>
      )}
    </div>
  )
}

function ResultCard({ item }: { item: Extract<TimelineItem, { type: 'result' }> }) {
  const tone = item.status === 'completed'
    ? { border: 'border-emerald-400/25', bg: 'bg-emerald-500/[0.06]', text: 'text-emerald-300' }
    : item.status === 'needs_input'
      ? { border: 'border-amber-400/25', bg: 'bg-amber-500/[0.06]', text: 'text-amber-300' }
      : { border: 'border-rose-400/25', bg: 'bg-rose-500/[0.06]', text: 'text-rose-300' }

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-3 space-y-2`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] uppercase tracking-[0.18em] font-medium ${tone.text}`}>{item.status}</span>
        {item.outcome && <span className="text-[10px] text-white/45">{item.outcome}</span>}
      </div>
      {item.summary && (
        <div className="text-[12px] text-white/80 leading-relaxed whitespace-pre-wrap break-words">
          {item.summary}
        </div>
      )}
      {item.stats && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] pt-1 border-t border-white/[0.06]">
          {item.stats.totalCostUsd !== undefined && <Stat label="cost" value={formatCost(item.stats.totalCostUsd)} />}
          {item.stats.durationMs !== undefined && <Stat label="time" value={formatDuration(item.stats.durationMs)} />}
          {item.stats.toolCalls !== undefined && <Stat label="tools" value={String(item.stats.toolCalls)} />}
          {item.stats.numTurns !== undefined && <Stat label="turns" value={String(item.stats.numTurns)} />}
          {item.stats.outputTokens !== undefined && <Stat label="tok out" value={formatTokens(item.stats.outputTokens)} />}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="uppercase tracking-[0.14em] text-white/30">{label}</span>
      <span className="font-mono text-white/70">{value}</span>
    </span>
  )
}

export function sessionElapsed(session: AgentSession, now: number): string | null {
  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : null
  if (!startedAt) return null
  const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : null
  return formatDuration((endedAt ?? now) - startedAt)
}

export function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return d.toLocaleDateString()
}

export function StatusDot({ status }: { status: string }) {
  const color = status === 'running' ? '#34d399'
    : status === 'queued' ? '#fbbf24'
    : status === 'succeeded' ? '#34d399'
    : status === 'failed' || status === 'timeout' ? '#fb7185'
    : status === 'killed' ? '#fb7185'
    : 'var(--primary)'
  const live = status === 'running' || status === 'queued'
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${live ? 'animate-pulse' : ''}`}
      style={{ background: color, boxShadow: live ? `0 0 6px ${color}` : undefined }}
    />
  )
}
