// ─────────────────────────────────────────────────────────────────────────
// Capture choke point — stream-class and valid-time defaults for createMemory.
//
// Every write path (MCP/REST create, capture webhook, session hooks, crons,
// board auto-capture) funnels through createMemory. When the caller does not
// pick a streamClass explicitly, this module decides one from (source, type,
// sourceMetadata) instead of letting everything fall to the DB default 'idea'
// — before this, every coding-session summary since June landed as 'idea'
// (confidence 0.6), outranking operator-adjacent signal. Explicit caller
// classes always win; that precedence lives in createMemory.
// Research: research/kairos_2909/03_capture_and_recency.md §C "Choke point".
// ─────────────────────────────────────────────────────────────────────────

import type { MemorySource, MemoryType } from '@/lib/data/validators'
import type { StreamClass } from './streamClass'

const AGENT_SESSION_SOURCES: ReadonlySet<string> = new Set(['claude', 'codex', 'copilot', 'hook'])
const MACHINE_SOURCES: ReadonlySet<string> = new Set(['cron', 'import'])
// P2.5: ingested third-party content is never the operator's reflection, so
// type 'reflection' alone doesn't earn the reflection stream (and its prior).
const EXTERNAL_SOURCES: ReadonlySet<string> = new Set(['import', 'webhook'])

function sessionMeta(sourceMetadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const session = sourceMetadata?.session
  return typeof session === 'object' && session !== null && !Array.isArray(session)
    ? session as Record<string, unknown>
    : null
}

// Returns undefined when no rule applies → DB default ('idea').
export function defaultStreamClass(
  source: MemorySource | string,
  type: MemoryType | string,
  sourceMetadata?: Record<string, unknown> | null,
): StreamClass | undefined {
  if (type === 'reflection' && !EXTERNAL_SOURCES.has(source)) return 'reflection'

  if (type === 'session_summary' && AGENT_SESSION_SOURCES.has(source)) {
    // A Hangar mission's CLI transcript row: the events route already writes
    // the mission memory, so the transcript is execution-grade, not a second
    // agentic signal for the same work.
    const hangarSessionId = sessionMeta(sourceMetadata)?.hangarSessionId
    return typeof hangarSessionId === 'string' && hangarSessionId.trim().length > 0
      ? 'execution'
      : 'agentic'
  }

  if (type === 'snapshot') return 'snapshot'

  if (source === 'system' && (type === 'achievement' || type === 'observation')) return 'execution'

  // WP3 — machine-derived imports/cron output stay out of the substrate pool
  // (incident 2026-07-20: stale card-facts defaulted to 'idea' poisoned chat).
  if (MACHINE_SOURCES.has(source)) return 'execution'

  return undefined
}

const VALID_AT_MAX_AGE_MS = 7 * 86_400_000

// When the work happened, not when the capture drained: a session's endedAt
// becomes validAt if it is a real past instant within the last 7 days (a
// backfilled session booked "yesterday" should window as yesterday). Anything
// else — missing, unparseable, future, or older — returns undefined so the DB
// default (write time) applies.
export function deriveValidAt(
  sourceMetadata: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): Date | undefined {
  const endedAt = sessionMeta(sourceMetadata)?.endedAt
  if (typeof endedAt !== 'string' && typeof endedAt !== 'number') return undefined
  if (typeof endedAt === 'string' && endedAt.trim().length === 0) return undefined
  const t = new Date(endedAt).getTime()
  if (!Number.isFinite(t)) return undefined
  const age = now.getTime() - t
  if (age < 0 || age > VALID_AT_MAX_AGE_MS) return undefined
  return new Date(t)
}
