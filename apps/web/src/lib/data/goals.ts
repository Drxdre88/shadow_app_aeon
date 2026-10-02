import { and, desc, eq, gte, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { activeEmbeddingModel, EMBEDDING_DIMENSIONS, toVectorLiteral } from '@/lib/kairos/embeddings'
import {
  GOAL_ORIGIN,
  GOAL_ORIGIN_VIA,
  GOAL_PROPOSAL_KIND,
  GOAL_TIMEOUT_GRACE_MS,
  GOAL_TITLE_MAX,
  GOAL_VETO_MEMORY_DAYS,
  readGoalMeta,
  type GoalMeta,
} from '@/lib/kairos/goals/parse'
import type { GoalState } from '@/lib/kairos/goals/state'

// Goal rows (Phase 2, Track A). Pure DB, no business rules: the state
// machine, policy and actor checks live in lib/kairos/goals/. Every state
// change is a compare-and-set on sourceMetadata.goal.state; proposals and
// approvals serialise per user on one advisory lock. Every read and count is
// scoped to rows the goal_propose handler wrote (origin.via).

export type GoalTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Q = typeof db | GoalTx

export const GOAL_LOCK_KEY = 'kairos_goals'
const DAY_MS = 86_400_000
const SCAN_CAP = 500
const SIMILARITY_POOL_CAP = 200

const goalField = (key: string) => sql`${memories.sourceMetadata}->'goal'->>${key}`
const goalState = goalField('state')
const goalTime = (key: string) => sql`(${goalField(key)})::timestamptz`
const hasGoal = sql`jsonb_typeof(${memories.sourceMetadata}->'goal') = 'object'`
const fromGoalPropose = sql`${memories.sourceMetadata}->'origin'->>'via' = ${GOAL_ORIGIN_VIA}`
const goalScope = (userId: string): SQL => and(eq(memories.userId, userId), hasGoal, fromGoalPropose)!
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`

export interface GoalRecord {
  id: string
  title: string
  type: string
  dominionId: string | null
  archivedAt: Date | null
  createdAt: Date
  meta: GoalMeta
}

const recordColumns = {
  id: memories.id,
  title: memories.title,
  type: memories.type,
  dominionId: memories.dominionId,
  archivedAt: memories.archivedAt,
  createdAt: memories.createdAt,
  sourceMetadata: memories.sourceMetadata,
}

type RawGoalRow = { id: string; title: string; type: string; dominionId: string | null; archivedAt: Date | null; createdAt: Date; sourceMetadata: unknown }

function toRecord(row: RawGoalRow): GoalRecord | null {
  const meta = readGoalMeta(row.sourceMetadata)
  if (!meta) return null
  return { id: row.id, title: row.title, type: row.type, dominionId: row.dominionId, archivedAt: row.archivedAt, createdAt: row.createdAt, meta }
}

const toRecords = (rows: RawGoalRow[]) => rows.map(toRecord).filter((r): r is GoalRecord => r !== null)

// Runs `fn` in one transaction holding the per-user goal lock.
export async function withGoalLock<T>(userId: string, fn: (tx: GoalTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${GOAL_LOCK_KEY}))`)
    return fn(tx)
  })
}

export async function findGoal(userId: string, goalId: string, q: Q = db): Promise<GoalRecord | null> {
  const [row] = await q
    .select(recordColumns)
    .from(memories)
    .where(and(eq(memories.id, goalId), goalScope(userId)))
    .limit(1)
  return row ? toRecord(row) : null
}

export interface OpenGoalCounts {
  active: number
  pending: number
}

// Active goals plus unexpired, unarchived proposals.
export async function countOpenGoals(userId: string, now: Date, q: Q = db): Promise<OpenGoalCounts> {
  const [row] = await q
    .select({
      active: sql<number>`count(*) filter (where ${goalState} = 'active')::int`,
      pending: sql<number>`count(*) filter (where ${goalState} = 'proposed' and ${goalTime('expiresAt')} > ${ts(now)})::int`,
    })
    .from(memories)
    .where(and(goalScope(userId), isNull(memories.archivedAt)))
  return { active: Number(row?.active ?? 0), pending: Number(row?.pending ?? 0) }
}

// One goal a night: any proposal stamped with this UTC day, whatever became of it.
export async function hasGoalProposedOn(userId: string, utcDay: string, q: Q = db): Promise<boolean> {
  const rows = await q
    .select({ id: memories.id })
    .from(memories)
    .where(and(goalScope(userId), sql`${goalField('proposedOn')} = ${utcDay}`))
    .limit(1)
  return rows.length > 0
}

export async function listOpenGoals(userId: string, now: Date, q: Q = db): Promise<GoalRecord[]> {
  const rows = await q
    .select(recordColumns)
    .from(memories)
    .where(and(
      goalScope(userId),
      isNull(memories.archivedAt),
      or(sql`${goalState} = 'active'`, sql`(${goalState} = 'proposed' and ${goalTime('expiresAt')} > ${ts(now)})`),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(SCAN_CAP)
  return toRecords(rows)
}

export interface GoalProposalInsert {
  title: string
  bodyMd: string
  summary: string | null
  dominionId: string | null
  meta: GoalMeta
  citations: readonly string[]
  embedding: number[] | null
  now: Date
}

function embeddingValues(embedding: number[] | null) {
  const usable = Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONS && embedding.every(Number.isFinite)
  return usable ? { embedding, embeddingModel: activeEmbeddingModel() } : {}
}

export async function insertGoalProposal(userId: string, input: GoalProposalInsert, q: Q = db): Promise<string> {
  const citations = [...new Set(input.citations)]
  const [row] = await q
    .insert(memories)
    .values({
      userId,
      dominionId: input.dominionId,
      title: input.title.slice(0, GOAL_TITLE_MAX),
      bodyMd: input.bodyMd,
      summary: input.summary,
      type: 'inbound',
      streamClass: 'agentic',
      confidence: confidenceForStreamClass('agentic'),
      source: 'cron',
      sourceMetadata: {
        kind: GOAL_PROPOSAL_KIND,
        status: 'pending',
        expiresAt: input.meta.expiresAt,
        citations,
        goal: input.meta,
        origin: GOAL_ORIGIN,
      },
      links: citations.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' as const })),
      tags: ['proposal', GOAL_PROPOSAL_KIND],
      pinned: false,
      ...embeddingValues(input.embedding),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: memories.id })
  if (!row) throw new Error('goal proposal insert returned no row')
  return row.id
}

export interface GoalCasSet {
  // Shallow-merged into sourceMetadata.goal.
  goal: Partial<GoalMeta>
  // sourceMetadata.status (the inbox / proposal status).
  status?: string
  type?: string
  archive?: boolean
}

// Compare-and-set: applies only while sourceMetadata.goal.state is still
// `from`. Null = no row moved (missing, not this user's, or already moved on).
export async function casGoalUpdate(
  userId: string,
  goalId: string,
  from: GoalState,
  set: GoalCasSet,
  now: Date,
  q: Q = db,
): Promise<GoalRecord | null> {
  const top = set.status !== undefined ? { status: set.status } : {}
  const rows = await q
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(${memories.sourceMetadata} || ${JSON.stringify(top)}::jsonb, '{goal}', (${memories.sourceMetadata}->'goal') || ${JSON.stringify(set.goal)}::jsonb)`,
      ...(set.type !== undefined ? { type: set.type } : {}),
      ...(set.archive ? { archivedAt: now } : {}),
      updatedAt: now,
    })
    .where(and(eq(memories.id, goalId), goalScope(userId), sql`${goalState} = ${from}`))
    .returning(recordColumns)
  return rows[0] ? toRecord(rows[0]) : null
}

// Proposals past their expiry and active goals past dueAt + 7 days.
export async function listStaleGoals(userId: string, now: Date, q: Q = db): Promise<GoalRecord[]> {
  const timeoutCutoff = new Date(now.getTime() - GOAL_TIMEOUT_GRACE_MS)
  const rows = await q
    .select(recordColumns)
    .from(memories)
    .where(and(
      goalScope(userId),
      or(
        sql`(${goalState} = 'proposed' and ${goalTime('expiresAt')} <= ${ts(now)})`,
        sql`(${goalState} = 'active' and ${goalTime('dueAt')} <= ${ts(timeoutCutoff)})`,
      ),
    ))
    .orderBy(memories.createdAt)
    .limit(SCAN_CAP)
  return toRecords(rows)
}

export interface GoalSimilarity {
  id: string
  state: string
  similarity: number
}

// Cosine against every active or pending goal and those vetoed in the last
// 30 days. The pool is tiny, so it is scanned (no ORDER BY on distance → no
// HNSW post-filter dropping the few rows that matter).
export async function listGoalSimilarities(userId: string, embedding: number[], now: Date): Promise<GoalSimilarity[]> {
  if (!Array.isArray(embedding) || embedding.length === 0) return []
  const vetoCutoff = new Date(now.getTime() - GOAL_VETO_MEMORY_DAYS * DAY_MS)
  const rows = await db
    .select({
      id: memories.id,
      state: sql<string>`${goalState}`,
      similarity: sql<number>`1 - (${memories.embedding} <=> ${toVectorLiteral(embedding)}::vector)`,
    })
    .from(memories)
    .where(and(
      goalScope(userId),
      isNotNull(memories.embedding),
      or(
        sql`${goalState} = 'active'`,
        sql`(${goalState} = 'proposed' and ${goalTime('expiresAt')} > ${ts(now)})`,
        sql`(${goalState} = 'vetoed' and ${goalTime('decidedAt')} >= ${ts(vetoCutoff)})`,
      ),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(SIMILARITY_POOL_CAP)
  return rows
    .map((r) => ({ id: r.id, state: r.state, similarity: Number(r.similarity) }))
    .filter((r) => Number.isFinite(r.similarity))
}

export interface FailedGoalSeed {
  id: string
  title: string
  question: string
}

// Goals that failed in the last `sinceDays` days — seeds for a better retry.
export async function listFailedGoals(userId: string, now: Date, sinceDays: number, limit = 10): Promise<FailedGoalSeed[]> {
  const since = new Date(now.getTime() - sinceDays * DAY_MS)
  const rows = await db
    .select(recordColumns)
    .from(memories)
    .where(and(goalScope(userId), sql`${goalState} = 'failed'`, sql`${goalTime('closedAt')} >= ${ts(since)}`))
    .orderBy(desc(goalTime('closedAt')))
    .limit(limit)
  return toRecords(rows).map((r) => ({ id: r.id, title: r.title, question: r.meta.question }))
}

// ── Metrics ────────────────────────────────────────────────────────────────

export interface GoalStats {
  proposed: number
  pending: number
  approved: number
  vetoed: number
  expired: number
  active: number
  done: number
  failed: number
  abandoned: number
  // approved / (approved + vetoed + expired); null before any decision.
  acceptanceRate: number | null
  // done (owner-confirmed) / (done + failed + abandoned); null before any close.
  doneCheckedRate: number | null
  medianDecisionMinutes: number | null
}

const APPROVED_STATES = new Set(['active', 'done', 'failed', 'abandoned'])

export function summariseGoalStats(goals: readonly GoalRecord[]): GoalStats {
  const count = (state: GoalState) => goals.filter((g) => g.meta.state === state).length
  const approved = goals.filter((g) => APPROVED_STATES.has(g.meta.state)).length
  const vetoed = count('vetoed')
  const expired = count('expired')
  const done = count('done')
  const failed = count('failed')
  const abandoned = count('abandoned')
  const minutes = goals
    .filter((g) => g.meta.decidedAt && (APPROVED_STATES.has(g.meta.state) || g.meta.state === 'vetoed'))
    .map((g) => (Date.parse(g.meta.decidedAt as string) - Date.parse(g.meta.proposedAt)) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b)
  const mid = Math.floor(minutes.length / 2)
  const median = minutes.length === 0 ? null : minutes.length % 2 ? minutes[mid] : (minutes[mid - 1] + minutes[mid]) / 2
  const decided = approved + vetoed + expired
  const closed = done + failed + abandoned
  return {
    proposed: goals.length,
    pending: count('proposed'),
    approved,
    vetoed,
    expired,
    active: count('active'),
    done,
    failed,
    abandoned,
    acceptanceRate: decided > 0 ? approved / decided : null,
    doneCheckedRate: closed > 0 ? done / closed : null,
    medianDecisionMinutes: median === null ? null : Math.round(median),
  }
}

// Goals proposed in the last `sinceDays` days.
export async function goalStats(userId: string, sinceDays: number, now: Date = new Date()): Promise<GoalStats> {
  const since = new Date(now.getTime() - Math.max(sinceDays, 0) * DAY_MS)
  const rows = await db
    .select(recordColumns)
    .from(memories)
    .where(and(goalScope(userId), gte(memories.createdAt, since)))
    .orderBy(desc(memories.createdAt))
    .limit(SCAN_CAP)
  return summariseGoalStats(toRecords(rows))
}
