import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { insertMemoryOps, type DbExecutor } from '@/lib/data/memory-ops'
import type { MemoryOpInput, OutcomeSummary } from '@/lib/kairos/engine/types'

// Operator reactions (docs/kairos/32 §2 "Reactions", §4a). Immediate, not
// nightly: accept/answer/cite → Usage (lastUsedAt, useCount) and Outcome
// positive; dismiss → Outcome negative. Every reaction is logged as a
// 'feedback' memory_op in the same transaction as its write. Writes are
// atomic SQL UPDATEs (no read-modify-write) and never bump updatedAt — that
// column drives confidence decay. Pure DB writes: the best-effort wrappers and
// the immediate rescore (docs/kairos/34 §6) live in lib/kairos/reactions.ts.

export type OutcomeKind = 'positive' | 'negative'

const REACTION_STEP = 'reaction'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// sourceMetadata.engine.outcome = { positive, negative } adjusted in SQL by
// the given deltas (floored at 0). Keeps every other key (including unknown
// ones under engine / engine.outcome) and repairs non-object parents rather
// than failing the write. Also used by revertMemoryOp to undo a reaction.
export function outcomeAdjustSql(deltaPositive: number, deltaNegative: number) {
  const sm = sql`(CASE WHEN jsonb_typeof(${memories.sourceMetadata}) = 'object' THEN ${memories.sourceMetadata} ELSE '{}'::jsonb END)`
  const engine = sql`(CASE WHEN jsonb_typeof(${sm} -> 'engine') = 'object' THEN ${sm} -> 'engine' ELSE '{}'::jsonb END)`
  const outcome = sql`(CASE WHEN jsonb_typeof(${engine} -> 'outcome') = 'object' THEN ${engine} -> 'outcome' ELSE '{}'::jsonb END)`
  const count = (key: 'positive' | 'negative') => {
    const k = sql.raw(`'${key}'`)
    return sql`(CASE WHEN jsonb_typeof(${outcome} -> ${k}) = 'number' THEN floor((${outcome} ->> ${k})::numeric)::int ELSE 0 END)`
  }
  return sql`jsonb_set(
    jsonb_set(${sm}, '{engine}', ${engine}, true),
    '{engine,outcome}',
    ${outcome} || jsonb_build_object(
      'positive', GREATEST(${count('positive')} + ${Math.trunc(deltaPositive)}::int, 0),
      'negative', GREATEST(${count('negative')} + ${Math.trunc(deltaNegative)}::int, 0)
    ),
    true
  )`
}

function outcomeMergeSql(kind: OutcomeKind) {
  return outcomeAdjustSql(kind === 'positive' ? 1 : 0, kind === 'negative' ? 1 : 0)
}

// Increments the proposal/memory's outcome counter. Returns the new totals, or
// null when the row does not exist for this user.
export async function recordOutcome(
  userId: string,
  memoryId: string,
  kind: OutcomeKind,
  tx: DbExecutor = db,
): Promise<OutcomeSummary | null> {
  if (!UUID_RE.test(memoryId)) return null
  const [row] = await tx
    .update(memories)
    .set({ sourceMetadata: outcomeMergeSql(kind) })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning({ outcome: sql<unknown>`${memories.sourceMetadata} #> '{engine,outcome}'` })
  if (!row) return null
  const o = (row.outcome ?? {}) as Record<string, unknown>
  return { positive: Number(o.positive) || 0, negative: Number(o.negative) || 0 }
}

// Use reinforcement: lastUsedAt = max(existing, at), useCount + 1. Unknown or
// non-uuid ids are skipped (ask/aether source ids are free-form strings).
export async function recordMemoryUse(
  userId: string,
  ids: readonly string[],
  at: Date = new Date(),
  tx: DbExecutor = db,
): Promise<Array<{ id: string; useCount: number }>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))]
  if (unique.length === 0) return []
  const atTs = sql`${at.toISOString()}::timestamp`
  return tx
    .update(memories)
    .set({
      lastUsedAt: sql`GREATEST(COALESCE(${memories.lastUsedAt}, ${atTs}), ${atTs})`,
      useCount: sql`${memories.useCount} + 1`,
    })
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique)))
    .returning({ id: memories.id, useCount: memories.useCount })
}

// ── Reaction writes (each with its 'feedback' op, in ONE transaction) ──
// A failed op insert rolls the counter back, so a reaction never lands
// without its (revertable) trail. These THROW on failure; the best-effort
// wrapper (log + swallow) and the follow-up rescore live in
// lib/kairos/reactions.ts — business orchestration stays out of lib/data.

// Outcome +1 on one memory, logged as a feedback op. Returns false (no
// transaction for a non-uuid id) when no row was touched.
export async function writeOutcomeReaction(
  userId: string,
  memoryId: string,
  kind: OutcomeKind,
  reason: string,
): Promise<boolean> {
  if (!UUID_RE.test(memoryId)) return false
  return db.transaction(async (tx) => {
    const totals = await recordOutcome(userId, memoryId, kind, tx)
    if (!totals) return false
    const before = {
      outcome: {
        positive: totals.positive - (kind === 'positive' ? 1 : 0),
        negative: totals.negative - (kind === 'negative' ? 1 : 0),
      },
    }
    await insertMemoryOps(userId, null, [{
      memoryId,
      step: REACTION_STEP,
      op: 'feedback',
      before,
      after: { outcome: totals },
      reason,
    }], tx)
    return true
  })
}

// Usage +1 on each uuid id, one feedback op per touched row. Returns the ids
// actually touched (no transaction at all when no id is a uuid).
export async function writeUseReaction(
  userId: string,
  ids: readonly string[],
  reason: string,
  at: Date = new Date(),
): Promise<string[]> {
  if (!ids.some((id) => UUID_RE.test(id))) return []
  return db.transaction(async (tx) => {
    const touched = await recordMemoryUse(userId, ids, at, tx)
    if (touched.length === 0) return []
    const ops: MemoryOpInput[] = touched.map((t) => ({
      memoryId: t.id,
      step: REACTION_STEP,
      op: 'feedback',
      before: { useCount: t.useCount - 1 },
      after: { useCount: t.useCount, lastUsedAt: at.toISOString() },
      reason,
    }))
    await insertMemoryOps(userId, null, ops, tx)
    return touched.map((t) => t.id)
  })
}