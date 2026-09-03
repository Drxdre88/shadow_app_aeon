// Flight Deck timeline builder. Pure function from a session's event rows to
// a render-ready mission timeline: tool calls paired with their results via
// toolUseId, subagent events nested under their spawning Task call, usage
// events folded into live token totals. No React, no I/O — the polling hook
// stays dumb and this stays unit-testable.

import type { SessionEvent } from '@/lib/db/schema'

export type ToolClass = 'read' | 'search' | 'edit' | 'bash' | 'subagent' | 'mcp' | 'web' | 'other'

export interface ToolItem {
  type: 'tool'
  seq: number
  toolName: string
  toolClass: ToolClass
  toolUseId: string | null
  input: string
  result: { content: string; isError: boolean } | null
  running: boolean
  children: TimelineItem[]
}

export type TimelineItem =
  | { type: 'init'; seq: number; model: string | null; permissionMode: string | null; version: string | null; toolCount: number | null }
  | ToolItem
  | { type: 'thinking'; seq: number; text: string }
  | { type: 'text'; seq: number; text: string }
  | { type: 'raw'; seq: number; text: string }
  | { type: 'error'; seq: number; message: string }
  | { type: 'stop'; seq: number; exitCode: number | null }
  | { type: 'result'; seq: number; status: string; outcome: string; summary: string; stats: MissionStats | null }

export interface MissionStats {
  totalCostUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  thinkingTokens?: number
  numTurns?: number
  durationMs?: number
  durationApiMs?: number
  toolCalls?: number
  model?: string
}

export interface LiveTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface Timeline {
  items: TimelineItem[]
  totals: LiveTotals
  stats: MissionStats | null
  terminal: boolean
}

export interface BuildTimelineOptions {
  /** The caller already knows the mission is over (session row status is
   *  terminal) even if no stop/result event ever landed — a killed or
   *  timed-out process must not leave tools spinning forever. */
  forceTerminal?: boolean
}

export function emptyTotals(): LiveTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
}

/** Fold one usage event into running totals (mutates and returns `totals`). */
export function addUsage(totals: LiveTotals, payload: Record<string, unknown>): LiveTotals {
  totals.requests++
  totals.inputTokens += numOrNull(payload.inputTokens) ?? 0
  totals.outputTokens += numOrNull(payload.outputTokens) ?? 0
  totals.cacheReadTokens += numOrNull(payload.cacheReadTokens) ?? 0
  totals.cacheCreationTokens += numOrNull(payload.cacheCreationTokens) ?? 0
  return totals
}

export function classifyTool(name: string): ToolClass {
  if (name.startsWith('mcp__')) return 'mcp'
  switch (name) {
    case 'Task': case 'Agent': return 'subagent'
    case 'Bash': case 'BashOutput': case 'KillShell': return 'bash'
    case 'Read': case 'NotebookRead': return 'read'
    case 'Glob': case 'Grep': return 'search'
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return 'edit'
    case 'WebSearch': case 'WebFetch': return 'web'
    default: return 'other'
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStats(value: unknown): MissionStats | null {
  if (!value || typeof value !== 'object') return null
  return value as MissionStats
}

export function buildTimeline(events: SessionEvent[], options: BuildTimelineOptions = {}): Timeline {
  const items: TimelineItem[] = []
  const toolsById = new Map<string, ToolItem>()
  // Totals here cover the events GIVEN — a caller that retains only a window
  // of a long mission must accumulate with addUsage as events arrive instead.
  const totals = emptyTotals()
  let stats: MissionStats | null = null
  let terminal = options.forceTerminal === true

  // A parented event nests under its spawning Task call when we know it;
  // an orphaned parent id degrades to top-level rather than dropping the event.
  const place = (item: TimelineItem, parentToolUseId: unknown): void => {
    const parent = typeof parentToolUseId === 'string' ? toolsById.get(parentToolUseId) : undefined
    if (parent) parent.children.push(item)
    else items.push(item)
  }

  for (const event of events) {
    const p = (event.payload ?? {}) as Record<string, unknown>

    switch (event.kind) {
      case 'system': {
        if (p.subtype === 'init') {
          items.push({
            type: 'init', seq: event.seq,
            model: str(p.model) || null,
            permissionMode: str(p.permissionMode) || null,
            version: str(p.version) || null,
            toolCount: numOrNull(p.toolCount),
          })
        } else if (p.subtype === 'hook_failed') {
          items.push({ type: 'error', seq: event.seq, message: `hook ${str(p.hookName) || '?'} failed (exit ${String(p.exitCode)})` })
        }
        break
      }
      case 'tool_use': {
        const name = event.toolName ?? 'tool'
        const item: ToolItem = {
          type: 'tool', seq: event.seq,
          toolName: name,
          toolClass: classifyTool(name),
          toolUseId: str(p.toolUseId) || null,
          input: str(p.input),
          result: null,
          running: true,
          children: [],
        }
        if (item.toolUseId) toolsById.set(item.toolUseId, item)
        place(item, p.parentToolUseId)
        break
      }
      case 'tool_result': {
        const tool = str(p.toolUseId) ? toolsById.get(str(p.toolUseId)) : undefined
        if (tool) {
          tool.result = { content: str(p.content), isError: p.isError === true }
          tool.running = false
        } else if (str(p.content)) {
          place({ type: 'raw', seq: event.seq, text: str(p.content) }, p.parentToolUseId)
        }
        break
      }
      case 'thinking':
        place({ type: 'thinking', seq: event.seq, text: str(p.text) }, p.parentToolUseId)
        break
      case 'message': {
        const text = str(p.text)
        if (!text) break
        if (p.stream === 'assistant') place({ type: 'text', seq: event.seq, text }, p.parentToolUseId)
        else items.push({ type: 'raw', seq: event.seq, text })
        break
      }
      case 'usage':
        addUsage(totals, p)
        break
      case 'error': {
        const message = str(p.message) || str(p.text)
        if (message) items.push({ type: 'error', seq: event.seq, message })
        break
      }
      case 'stop':
        terminal = true
        items.push({ type: 'stop', seq: event.seq, exitCode: numOrNull(p.exitCode) })
        break
      case 'result': {
        terminal = true
        stats = readStats(p.stats) ?? stats
        items.push({
          type: 'result', seq: event.seq,
          status: str(p.status) || 'failed',
          outcome: str(p.outcome),
          summary: str(p.summary),
          stats: readStats(p.stats),
        })
        break
      }
      // 'status' rows (dispatch bookkeeping) carry no timeline value.
      default:
        break
    }
  }

  // A finished mission has no spinning tools, even when a result row never
  // paired up (killed process, lost batch).
  if (terminal) {
    for (const tool of toolsById.values()) tool.running = false
  }

  return { items, totals, stats, terminal }
}

// ── display helpers (shared by drawer + tower) ───────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatCost(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m ${Math.round((ms % 60_000) / 1000)}s`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

// Heartbeats arrive every ~30s; treat 3 missed beats as "unresponsive".
// Display-only — a stale runner is NEVER auto-failed (rule E1), the mission
// may still be alive behind a network blip.
export const HEARTBEAT_STALE_MS = 90_000

export function heartbeatStale(lastHeartbeatAt: Date | string | null, now = Date.now()): boolean {
  if (!lastHeartbeatAt) return false
  const beat = typeof lastHeartbeatAt === 'string' ? new Date(lastHeartbeatAt).getTime() : lastHeartbeatAt.getTime()
  return Number.isFinite(beat) && now - beat > HEARTBEAT_STALE_MS
}
