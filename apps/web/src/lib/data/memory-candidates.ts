import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, memoryOps } from '@/lib/db/schema'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'
import { insertMemoryOps, type DbExecutor, type OpLog } from './memory-ops'
import { outcomeAdjustSql } from './memory-reactions'
import { validAsOfNow } from './memories'

// Memory engine — data access for the BackUp (candidate tier) and Merge steps
// and for reverting a logged op (docs/kairos/32 §2.1, §2.3, §2.5). Pure
// queries: every decision (thresholds, independence, what to restore) lives in
// lib/kairos/engine; this file only reads and writes the rows it is told to.

const liveRow = and(isNull(memories.archivedAt), isNull(memories.supersededAt), validAsOfNow)
const nonMeta = notInArray(memories.streamClass, [...META_STREAM_CLASSES])

// Cosine distance of each row to another stored row's embedding, computed in
// SQL so the 1024-dim vector never round-trips through JS.
function distanceTo(userId: string, memoryId: string): SQL<number> {
  return sql<number>`(${memories.embedding} <=> (SELECT m2.embedding FROM memories m2 WHERE m2.id = ${memoryId} AND m2.user_id = ${userId}))`
}

// ── BackUp: pending introspection proposals ─────────────────────────────────

export interface ProposalCandidateRow {
  id: string
  title: string
  createdAt: Date
  streamClass: string
  confidence: number | null
  sourceMetadata: Record<string, unknown>
  hasEmbedding: boolean
}

// Pending introspection proposals only — contradiction notices are verdicts,
// resolved by the operator, never by corroboration. Oldest first so the ones
// closest to their decay deadline are always inside the per-run cap.
export async function listPendingProposalCandidates(userId: string, limit: number): Promise<ProposalCandidateRow[]> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      createdAt: memories.createdAt,
      streamClass: memories.streamClass,
      confidence: memories.confidence,
      sourceMetadata: memories.sourceMetadata,
      hasEmbedding: sql<boolean>`(${memories.embedding} IS NOT NULL)`,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      sql`${memories.sourceMetadata}->>'introspection' = 'true'`,
      sql`${memories.sourceMetadata}->>'status' = 'pending'`,
      sql`COALESCE(${memories.sourceMetadata}->>'contradictionCheck', 'false') <> 'true'`,
      // Review actions and constitution amendments are operator decisions, not
      // hypotheses: evidence must never promote or decay them.
      sql`COALESCE(${memories.sourceMetadata}->>'kind', '') NOT IN ('review_action', 'constitution_amendment')`,
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
    ))
    .orderBy(asc(memories.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }))
}

export interface SupportRow {
  id: string
  source: string
  createdAt: Date
  sourceMetadata: Record<string, unknown>
  links: Array<{ type?: string; target?: string }>
  similarity: number
}

// Live non-meta memories written after the proposal whose embedding is within
// `maxDistance` (cosine distance = 1 − similarity) of it. Independence is
// judged by the caller.
export async function findProposalSupports(
  userId: string,
  proposalId: string,
  createdAfter: Date,
  maxDistance: number,
  limit = 50,
): Promise<SupportRow[]> {
  const distance = distanceTo(userId, proposalId)
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
    return tx
      .select({
        id: memories.id,
        source: memories.source,
        createdAt: memories.createdAt,
        sourceMetadata: memories.sourceMetadata,
        links: memories.links,
        distance,
      })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        sql`${memories.id} <> ${proposalId}`,
        gt(memories.createdAt, createdAfter),
        isNotNull(memories.embedding),
        nonMeta,
        liveRow,
        sql`${distance} <= ${maxDistance}`,
      ))
      .orderBy(distance)
      .limit(limit)
  })
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    createdAt: r.createdAt,
    sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>,
    links: Array.isArray(r.links) ? (r.links as SupportRow['links']) : [],
    similarity: 1 - Number(r.distance),
  }))
}

export interface ProposalPatch {
  sourceMetadata: Record<string, unknown>
  streamClass?: string
  confidence?: number
  archivedAt?: Date
  updatedAt?: Date
}

// Guarded on the proposal still being pending: an operator accept/dismiss that
// landed mid-run wins. Returns false when the guard rejected the write. With
// `log`, the ops are inserted in the same transaction as the update — a failed
// op insert rolls the update back (throws), and a rejected guard logs nothing.
export async function updatePendingProposal(
  userId: string,
  proposalId: string,
  patch: ProposalPatch,
  log?: OpLog,
): Promise<boolean> {
  const write = async (tx: DbExecutor) => {
    const updated = await tx
      .update(memories)
      .set(patch)
      .where(and(
        eq(memories.id, proposalId),
        eq(memories.userId, userId),
        sql`${memories.sourceMetadata}->>'status' = 'pending'`,
        isNull(memories.archivedAt),
      ))
      .returning({ id: memories.id })
    return updated.length > 0
  }
  if (!log) return write(db)
  return db.transaction(async (tx) => {
    if (!(await write(tx))) return false
    await insertMemoryOps(userId, log.runId, log.ops, tx)
    return true
  })
}

export interface ProposalWrite {
  id: string
  patch: ProposalPatch
  // Ops describing this write; inserted only if the write lands.
  ops: readonly MemoryOpInput[]
}

const tsParam = (d: Date | undefined) => (d ? d.toISOString() : null)

// Below the pool's 15s client query_timeout (lib/db).
const BATCH_STATEMENT_TIMEOUT_MS = 10_000

// Batched updatePendingProposal: one set-based UPDATE … FROM (VALUES …) under
// the same pending guard, then the ops of exactly the rows that landed, in ONE
// transaction — the batch and its trail commit together or not at all.
// Unset patch fields keep the row's value (as .set() skips undefined keys).
// Returns the ids whose write landed.
export async function updatePendingProposals(
  userId: string,
  writes: readonly ProposalWrite[],
  runId: string | null,
): Promise<Set<string>> {
  if (writes.length === 0) return new Set()
  const values = sql.join(writes.map((w) => sql`(${w.id}::uuid, ${JSON.stringify(w.patch.sourceMetadata)}::jsonb, ${w.patch.streamClass ?? null}::varchar, ${w.patch.confidence ?? null}::real, ${tsParam(w.patch.archivedAt)}::timestamp, ${tsParam(w.patch.updatedAt)}::timestamp)`), sql`, `)
  return db.transaction(async (tx) => {
    // Server-side cap below the client's 15s query timeout: a slow batch is
    // cancelled (releasing its row locks) instead of running on after the
    // client gave up, so the caller's per-row retry isn't blocked behind it.
    await tx.execute(sql`SET LOCAL statement_timeout = ${sql.raw(String(BATCH_STATEMENT_TIMEOUT_MS))}`)
    const res = await tx.execute(sql`
      UPDATE memories AS m
      SET source_metadata = v.source_metadata,
          stream_class = COALESCE(v.stream_class, m.stream_class),
          confidence = COALESCE(v.confidence, m.confidence),
          archived_at = COALESCE(v.archived_at, m.archived_at),
          updated_at = COALESCE(v.updated_at, m.updated_at)
      FROM (VALUES ${values}) AS v(id, source_metadata, stream_class, confidence, archived_at, updated_at)
      WHERE m.id = v.id
        AND m.user_id = ${userId}
        AND m.source_metadata->>'status' = 'pending'
        AND m.archived_at IS NULL
      RETURNING m.id
    `)
    const landed = new Set((res.rows as Array<{ id: unknown }>).map((r) => String(r.id)))
    const ops = writes.flatMap((w) => (landed.has(w.id) ? w.ops : []))
    if (ops.length > 0) await insertMemoryOps(userId, runId, ops, tx)
    return landed
  })
}

// ── Merge: near-duplicate new rows ──────────────────────────────────────────

export interface MergeCandidateRow {
  id: string
  type: string
  streamClass: string
  createdAt: Date
  sourceMetadata: Record<string, unknown>
}

// Merge candidates: live, unpinned, embedded rows created since `since`.
// Oldest first with an id tiebreak so the capped slice is deterministic and
// always holds the rows about to age out of the window (docs/kairos/32 §2.1).
export async function listMergeCandidates(
  userId: string,
  since: Date,
  opts: { excludeTypes: readonly string[]; excludeStreams: readonly string[]; limit: number },
): Promise<MergeCandidateRow[]> {
  const rows = await db
    .select({
      id: memories.id,
      type: memories.type,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      gte(memories.createdAt, since),
      isNotNull(memories.embedding),
      eq(memories.pinned, false),
      notInArray(memories.streamClass, [...META_STREAM_CLASSES, ...opts.excludeStreams]),
      notInArray(memories.type, [...opts.excludeTypes]),
      liveRow,
    ))
    .orderBy(asc(memories.createdAt), asc(memories.id))
    .limit(opts.limit)
  return rows.map((r) => ({ ...r, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }))
}

export interface DuplicateRow {
  id: string
  useCount: number
  lastUsedAt: Date | null
  similarity: number
}

// Nearest OLDER live row of the same user + stream class within maxDistance.
export async function findOlderDuplicate(
  userId: string,
  row: { id: string; streamClass: string; createdAt: Date },
  opts: { maxDistance: number; excludeTypes: readonly string[]; excludeIds: readonly string[] },
): Promise<DuplicateRow | null> {
  const distance = distanceTo(userId, row.id)
  const [hit] = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
    return tx
      .select({ id: memories.id, useCount: memories.useCount, lastUsedAt: memories.lastUsedAt, distance })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        sql`${memories.id} <> ${row.id}`,
        eq(memories.streamClass, row.streamClass),
        lt(memories.createdAt, row.createdAt),
        isNotNull(memories.embedding),
        notInArray(memories.type, [...opts.excludeTypes]),
        ...(opts.excludeIds.length ? [notInArray(memories.id, [...opts.excludeIds])] : []),
        liveRow,
        sql`${distance} <= ${opts.maxDistance}`,
      ))
      .orderBy(distance)
      .limit(1)
  })
  if (!hit) return null
  return { id: hit.id, useCount: hit.useCount, lastUsedAt: hit.lastUsedAt, similarity: 1 - Number(hit.distance) }
}

// Newer → superseded by older (valid time untouched: a repeat, not a
// correction); older reinforced. Atomic, and only when the newer is still live.
// With `log`, its ops are inserted in the same transaction (a failed op insert
// rolls the merge back).
export async function applyMerge(userId: string, newerId: string, olderId: string, now: Date, log?: OpLog): Promise<boolean> {
  return db.transaction(async (tx) => {
    const superseded = await tx
      .update(memories)
      .set({ supersededAt: now, supersededById: olderId })
      .where(and(eq(memories.id, newerId), eq(memories.userId, userId), isNull(memories.supersededAt)))
      .returning({ id: memories.id })
    if (superseded.length === 0) return false
    await tx
      .update(memories)
      .set({ useCount: sql`${memories.useCount} + 1`, lastUsedAt: now })
      .where(and(eq(memories.id, olderId), eq(memories.userId, userId)))
    if (log) await insertMemoryOps(userId, log.runId, log.ops, tx)
    return true
  })
}

// ── Revert ─────────────────────────────────────────────────────────────────

export interface RevertableMemoryRow {
  id: string
  title: string
  bodyMd: string
  summary: string | null
  links: unknown
  tags: unknown
  streamClass: string
  confidence: number | null
  standing: number | null
  standingAt: Date | null
  archivedAt: Date | null
  supersededAt: Date | null
  supersededById: string | null
  invalidAt: Date | null
  lastUsedAt: Date | null
  useCount: number
  sourceMetadata: Record<string, unknown>
}

export async function findRevertableMemories(userId: string, ids: string[]): Promise<RevertableMemoryRow[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      summary: memories.summary,
      links: memories.links,
      tags: memories.tags,
      streamClass: memories.streamClass,
      confidence: memories.confidence,
      standing: memories.standing,
      standingAt: memories.standingAt,
      archivedAt: memories.archivedAt,
      supersededAt: memories.supersededAt,
      supersededById: memories.supersededById,
      invalidAt: memories.invalidAt,
      lastUsedAt: memories.lastUsedAt,
      useCount: memories.useCount,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, ids)))
  return rows.map((r) => ({ ...r, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }))
}

export interface MemoryRestorePatch {
  memoryId: string
  set: {
    title?: string
    bodyMd?: string
    summary?: string | null
    links?: unknown
    tags?: unknown
    // Content restored → re-embed on the next backfill (mirrors updateMemory).
    embedding?: null
    embeddingModel?: null
    streamClass?: string
    confidence?: number | null
    standing?: number | null
    standingAt?: Date | null
    archivedAt?: Date | null
    supersededAt?: Date | null
    supersededById?: string | null
    invalidAt?: Date | null
    lastUsedAt?: Date | null
    useCount?: number
    sourceMetadata?: Record<string, unknown>
  }
  // Undo one reinforcement relative to the CURRENT count (later uses survive).
  decrementUseCount?: boolean
  // Undo a reaction's outcome relative to the CURRENT counters (atomic
  // jsonb_set, floored at 0) — later reactions survive. Ignored when
  // set.sourceMetadata is present (a whole-object restore wins).
  outcomeDelta?: { positive: number; negative: number }
}

export class MemoryOpRevertRaceError extends Error {
  constructor() {
    super('memory op was reverted concurrently')
  }
}

// Restore + revert-op insert + mark reverted in ONE transaction, so a memory
// is never restored without its trail (or marked reverted without the restore).
// Throws MemoryOpRevertRaceError (rolling back) when another revert won.
export async function applyMemoryOpRevert(
  userId: string,
  opId: string,
  patches: readonly MemoryRestorePatch[],
  revertOp: MemoryOpInput,
): Promise<string> {
  return db.transaction(async (tx) => {
    for (const p of patches) {
      const set: Record<string, unknown> = { ...p.set }
      if (p.decrementUseCount) set.useCount = sql`GREATEST(${memories.useCount} - 1, 0)`
      if (p.outcomeDelta && !('sourceMetadata' in set)) {
        set.sourceMetadata = outcomeAdjustSql(p.outcomeDelta.positive, p.outcomeDelta.negative)
      }
      if (Object.keys(set).length === 0) continue
      await tx
        .update(memories)
        .set(set)
        .where(and(eq(memories.id, p.memoryId), eq(memories.userId, userId)))
    }
    const [inserted] = await tx
      .insert(memoryOps)
      .values({
        userId,
        runId: null,
        memoryId: revertOp.memoryId,
        step: revertOp.step,
        op: revertOp.op,
        before: revertOp.before ?? null,
        after: revertOp.after ?? null,
        reason: revertOp.reason,
      })
      .returning({ id: memoryOps.id })
    const marked = await tx
      .update(memoryOps)
      .set({ revertedAt: new Date(), revertedByOpId: inserted.id })
      .where(and(eq(memoryOps.id, opId), eq(memoryOps.userId, userId), isNull(memoryOps.revertedAt)))
      .returning({ id: memoryOps.id })
    if (marked.length === 0) throw new MemoryOpRevertRaceError()
    return inserted.id
  })
}

// ── Digest: today's promotions ─────────────────────────────────────────────

export interface PromotedBelief {
  opId: string
  memoryId: string
  title: string
}

export async function listPromotedBeliefsBetween(
  userId: string,
  start: Date,
  end: Date,
  limit: number,
): Promise<PromotedBelief[]> {
  const rows = await db
    .select({ opId: memoryOps.id, memoryId: memories.id, title: memories.title, aiTitle: memories.aiTitle })
    .from(memoryOps)
    .innerJoin(memories, and(eq(memories.id, memoryOps.memoryId), eq(memories.userId, userId)))
    .where(and(
      eq(memoryOps.userId, userId),
      eq(memoryOps.op, 'promote'),
      // Engine promotions only — belief-ledger writes (step 'beliefs') and
      // constitution versions log 'promote' too but are not "I now believe" news.
      eq(memoryOps.step, 'backup'),
      isNull(memoryOps.revertedAt),
      gte(memoryOps.createdAt, start),
      lt(memoryOps.createdAt, end),
    ))
    .orderBy(asc(memoryOps.createdAt))
    .limit(limit)
  return rows.map((r) => ({ opId: r.opId, memoryId: r.memoryId, title: r.aiTitle || r.title }))
}
