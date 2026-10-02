import { and, asc, desc, eq, gte, inArray, isNull, like, lte, notLike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, thinkingJobs } from '@/lib/db/schema'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
  ThinkingJobStatus,
} from '@/lib/kairos/engine/types'

// Thinking queue — pure DB access for `thinking_jobs` (docs/kairos/32 §3).
// No auth, no business logic: the queue (lib/kairos/thinking/queue.ts) owns
// planning, handler dispatch and status semantics. Every query is scoped to
// the calling user except the cron-only helpers at the bottom.

type DbRow = typeof thinkingJobs.$inferSelect

const OPEN_STATUSES: ThinkingJobStatus[] = ['queued', 'claimed']

function toRow(r: DbRow): ThinkingJobRow {
  return r as unknown as ThinkingJobRow
}

// Idempotent insert: unique(user_id, external_key) settles re-planning, so a
// second plan of the same job returns null instead of a duplicate.
export async function upsertJob(userId: string, spec: ThinkingJobSpec, now: Date = new Date()): Promise<ThinkingJobRow | null> {
  const [row] = await db
    .insert(thinkingJobs)
    .values({
      userId,
      kind: spec.kind,
      dominionId: spec.dominionId,
      externalKey: spec.externalKey,
      status: 'queued',
      input: spec.input,
      deadlineAt: new Date(now.getTime() + spec.deadlineMinutes * 60_000),
    })
    .onConflictDoNothing({ target: [thinkingJobs.userId, thinkingJobs.externalKey] })
    .returning()
  return row ? toRow(row) : null
}

// Atomic single-statement claim: the sub-select locks the oldest claimable row
// with SKIP LOCKED so concurrent claimers never receive the same job, and the
// outer UPDATE re-checks status after the lock. One statement, so it works on
// the HTTP (poolQueryViaFetch) path without a transaction.
// Without a kinds filter, 'chat' jobs are excluded: a chat reply is plain
// text for the chat routine (web + Telegram), so it is only claimable by asking for it
// explicitly (kinds including 'chat') — never by a nightly/morning drain.
export const EXPLICIT_ONLY_KINDS: readonly ThinkingJobKind[] = ['chat']

export async function claimNextJob(
  userId: string,
  kinds?: readonly ThinkingJobKind[],
  claimedBy: import('@/lib/kairos/engine/types').ThinkingClaimedBy = 'routine',
): Promise<ThinkingJobRow | null> {
  const kindFilter = kinds && kinds.length > 0
    ? sql` AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`
    : sql` AND kind NOT IN (${sql.join(EXPLICIT_ONLY_KINDS.map((k) => sql`${k}`), sql`, `)})`
  const [row] = await db
    .update(thinkingJobs)
    .set({
      status: 'claimed',
      claimedBy,
      claimToken: sql`gen_random_uuid()`,
      claimedAt: sql`now()`,
      attempts: sql`${thinkingJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.status, 'queued'),
      sql`${thinkingJobs.id} = (SELECT id FROM thinking_jobs WHERE user_id = ${userId} AND status = 'queued' AND deadline_at > now()${kindFilter} ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)`,
    ))
    .returning()
  return row ? toRow(row) : null
}

export async function findJobById(userId: string, id: string): Promise<ThinkingJobRow | null> {
  const [row] = await db
    .select()
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.id, id), eq(thinkingJobs.userId, userId)))
    .limit(1)
  return row ? toRow(row) : null
}

// Only the current claim holder can complete: status must still be 'claimed'
// and the token must match, so a late or replayed submit is a no-op (null).
export async function completeJob(
  userId: string,
  id: string,
  claimToken: string,
  output: Record<string, unknown>,
  answeredBy: ThinkingAnsweredBy,
): Promise<ThinkingJobRow | null> {
  const now = new Date()
  const [row] = await db
    .update(thinkingJobs)
    .set({ status: 'done', output, claimedBy: answeredBy, completedAt: now, error: null, updatedAt: now })
    .where(and(
      eq(thinkingJobs.id, id),
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.status, 'claimed'),
      eq(thinkingJobs.claimToken, claimToken),
    ))
    .returning()
  return row ? toRow(row) : null
}

// Terminal failure of an open job. With a token, only the claim holder can
// fail it; without one (server-side), any open job can be failed.
export async function failJob(
  userId: string,
  id: string,
  claimToken: string | null,
  error: string,
): Promise<ThinkingJobRow | null> {
  const now = new Date()
  const conds: SQL[] = [
    eq(thinkingJobs.id, id),
    eq(thinkingJobs.userId, userId),
    inArray(thinkingJobs.status, OPEN_STATUSES),
  ]
  if (claimToken) conds.push(eq(thinkingJobs.claimToken, claimToken))
  const [row] = await db
    .update(thinkingJobs)
    .set({ status: 'failed', error: error.slice(0, 2000), completedAt: now, updatedAt: now })
    .where(and(...conds))
    .returning()
  return row ? toRow(row) : null
}

// Queued or claimed jobs past their deadline → 'expired'. Returns the rows so
// the sweep can run each kind's fallback.
export async function expireOverdue(now: Date = new Date(), userId?: string): Promise<ThinkingJobRow[]> {
  const conds: SQL[] = [
    inArray(thinkingJobs.status, OPEN_STATUSES),
    lte(thinkingJobs.deadlineAt, now),
  ]
  if (userId) conds.push(eq(thinkingJobs.userId, userId))
  const rows = await db
    .update(thinkingJobs)
    .set({ status: 'expired', error: 'deadline passed before a routine answered', updatedAt: now })
    .where(and(...conds))
    .returning()
  return rows.map(toRow)
}

// Record a handler fallback run on an expired job: ok → status 'fallback'
// with the persisted ids; not ok → stays 'expired' with the reason, prefixed
// FALLBACK_ERROR_PREFIX — that prefix is what marks the fallback as attempted
// (listPendingFallbacks skips it), so a failed fallback is never re-run.
export const FALLBACK_ERROR_PREFIX = 'fallback:'

export async function recordFallback(
  userId: string,
  id: string,
  outcome: ApplyOutcome,
  now: Date = new Date(),
): Promise<ThinkingJobRow | null> {
  // Same merge as a routine completion: handler output (e.g. a draft) first,
  // memoryIds last so a handler can never shadow them.
  const set = outcome.ok
    ? { status: 'fallback', output: { ...(outcome.output ?? {}), memoryIds: outcome.memoryIds }, completedAt: now, updatedAt: now }
    : { error: `${FALLBACK_ERROR_PREFIX} ${outcome.reason}`.slice(0, 2000), updatedAt: now }
  const [row] = await db
    .update(thinkingJobs)
    .set(set)
    .where(and(eq(thinkingJobs.id, id), eq(thinkingJobs.userId, userId), eq(thinkingJobs.status, 'expired')))
    .returning()
  return row ? toRow(row) : null
}

// Hand a claimed job to the sweep's fallback instead of failing it (late or
// rejected routine answer for a kind whose handler owns a fallback). Only the
// claim holder can do this; the job becomes 'expired' with the reason, which
// makes it pending for listPendingFallbacks.
export async function releaseForFallback(
  userId: string,
  id: string,
  claimToken: string,
  error: string,
): Promise<ThinkingJobRow | null> {
  const now = new Date()
  const [row] = await db
    .update(thinkingJobs)
    .set({ status: 'expired', error: error.slice(0, 2000), updatedAt: now })
    .where(and(
      eq(thinkingJobs.id, id),
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.status, 'claimed'),
      eq(thinkingJobs.claimToken, claimToken),
    ))
    .returning()
  return row ? toRow(row) : null
}

// Expired jobs of `kinds` whose fallback has not been attempted yet, oldest
// deadline first.
function pendingFallbackCond(kinds: readonly ThinkingJobKind[]): SQL {
  return and(
    eq(thinkingJobs.status, 'expired'),
    inArray(thinkingJobs.kind, [...kinds]),
    or(isNull(thinkingJobs.error), notLike(thinkingJobs.error, `${FALLBACK_ERROR_PREFIX}%`)),
  )!
}

export async function listPendingFallbacks(
  userId: string,
  kinds: readonly ThinkingJobKind[],
  limit = 50,
): Promise<ThinkingJobRow[]> {
  if (kinds.length === 0) return []
  const rows = await db
    .select()
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), pendingFallbackCond(kinds)))
    .orderBy(asc(thinkingJobs.deadlineAt))
    .limit(Math.min(Math.max(limit, 1), 200))
  return rows.map(toRow)
}

// Does any job of `kind` have an externalKey matching the LIKE `pattern`?
export async function hasJobWithKeyLike(userId: string, kind: ThinkingJobKind, pattern: string): Promise<boolean> {
  const [row] = await db
    .select({ id: thinkingJobs.id })
    .from(thinkingJobs)
    .where(and(
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.kind, kind),
      like(thinkingJobs.externalKey, pattern),
    ))
    .limit(1)
  return Boolean(row)
}

// Cron-fallback guard (all-on-Max kinds): a cron skips a unit of work when
// the routine already completed its job. Only 'done' counts — a failed or
// expired job is exactly what the cron is there to cover.
export async function isJobDone(userId: string, externalKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: thinkingJobs.id })
    .from(thinkingJobs)
    .where(and(
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.externalKey, externalKey),
      eq(thinkingJobs.status, 'done'),
    ))
    .limit(1)
  return Boolean(row)
}

// Any job of `kind` still open (queued/claimed) and before its deadline —
// used to order kinds within a night (archetype waits on chat_distill).
export async function hasLiveOpenJob(userId: string, kind: ThinkingJobKind, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: thinkingJobs.id })
    .from(thinkingJobs)
    .where(and(
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.kind, kind),
      inArray(thinkingJobs.status, OPEN_STATUSES),
      gte(thinkingJobs.deadlineAt, now),
    ))
    .limit(1)
  return Boolean(row)
}

export interface ListJobsFilter {
  status?: ThinkingJobStatus
  kind?: ThinkingJobKind
  since?: Date
  limit?: number
}

export async function listJobs(userId: string, filter: ListJobsFilter = {}): Promise<ThinkingJobRow[]> {
  const conds: SQL[] = [eq(thinkingJobs.userId, userId)]
  if (filter.status) conds.push(eq(thinkingJobs.status, filter.status))
  if (filter.kind) conds.push(eq(thinkingJobs.kind, filter.kind))
  if (filter.since) conds.push(gte(thinkingJobs.createdAt, filter.since))
  const rows = await db
    .select()
    .from(thinkingJobs)
    .where(and(...conds))
    .orderBy(desc(thinkingJobs.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 20, 1), 200))
  return rows.map(toRow)
}

// Cron-only: every user the sweep has work for — an open (queued/claimed)
// job to expire, or an expired job of `fallbackKinds` still awaiting its
// fallback (released by a late/rejected submit, or deferred by a budgeted
// earlier sweep).
export async function listUsersNeedingSweep(fallbackKinds: readonly ThinkingJobKind[]): Promise<string[]> {
  const open = inArray(thinkingJobs.status, OPEN_STATUSES)
  const rows = await db
    .selectDistinct({ userId: thinkingJobs.userId })
    .from(thinkingJobs)
    .where(fallbackKinds.length > 0 ? or(open, pendingFallbackCond(fallbackKinds)) : open)
  return rows.map((r) => r.userId)
}

// Planning prerequisites (lazy planning in the queue). Live archetype rows
// written since `since`, grouped by Dominion — cortex waits for these.
export async function listDominionsWithArchetypesSince(userId: string, since: Date): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ dominionId: memories.dominionId })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
      gte(memories.createdAt, since),
    ))
  return new Set(rows.map((r) => r.dominionId).filter((id): id is string => Boolean(id)))
}

// Live cortex rows written since `since` — aether waits for these.
export async function countCortexRowsSince(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
      gte(memories.createdAt, since),
    ))
  return row?.n ?? 0
}

// Shallow jsonb merge into `output` (top-level keys of `patch` win), any
// status. completeJob/recordFallback replace `output` wholesale, so this is
// for stamps written after a job settles (e.g. chat timing). Leaves
// updatedAt alone: the stamp is bookkeeping, not a state change.
export async function mergeJobOutput(
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const [row] = await db
    .update(thinkingJobs)
    .set({ output: sql`coalesce(${thinkingJobs.output}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(thinkingJobs.id, id), eq(thinkingJobs.userId, userId)))
    .returning({ id: thinkingJobs.id })
  return Boolean(row)
}
