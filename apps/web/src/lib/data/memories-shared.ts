import { sql } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { notHeldSensitive } from '@/lib/kairos/sensitive'

// Leaf module shared by memories.ts and its split-out search/context modules,
// so module-level constants never sit inside the memories.ts import cycle.

// Slim memory projection used by list/search reads (no body, no vector).
export const SLIM_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  type: memories.type,
  source: memories.source,
  sourceMetadata: memories.sourceMetadata,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
  realmId: memories.realmId,
  projectId: memories.projectId,
  taskId: memories.taskId,
  tags: memories.tags,
  pinned: memories.pinned,
  // Governed-memory trust prior, peer to `pinned`. Feeds read-time confidence
  // decay in retrieval scoring; intentionally surfaced to search consumers (the
  // caller's own non-sensitive prior) — MCP/REST stay in parity via this shared set.
  confidence: memories.confidence,
  // Memory-engine standing (docs/kairos/32 §1). Feeds the shared ranker
  // (lib/kairos/ranking.ts); NULL = unscored → P0 confidence × recency.
  standing: memories.standing,
} as const

// Bi-temporal valid-time gate. A belief participates in retrieval only while it
// is valid as-of now: invalid_at unset, or still in the future. Composes with
// the supersededAt gate — accepting a supersession stamps invalid_at, but a
// belief can also expire on its own without a successor. Reused across every
// retrieval leg so the corpus is filtered identically. Re-exported from
// memories.ts, which stays the import path for every other module.
export const validAsOfNow = sql`((${memories.invalidAt} IS NULL OR ${memories.invalidAt} > NOW()) AND ${notHeldSensitive})`
