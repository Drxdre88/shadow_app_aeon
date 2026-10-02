import { and, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { activeEmbeddingModel, EMBEDDING_DIMENSIONS, toVectorLiteral } from '@/lib/kairos/embeddings'
import type { Origin } from '@/lib/kairos/origin'
import {
  IDEA_CANDIDATE_TYPE,
  IDEA_PROPOSAL_KIND,
  type IdeaMeta,
  type IdeaOutcome,
} from '@/lib/kairos/ideas/types'
import { isBelief, liveHeld } from './beliefs'

// Idea archive data access (P3 Creativity, docs/kairos/35). Pure DB, no model.
// The archive is every memory carrying sourceMetadata.idea: surviving
// proposals (type 'inbound' until the operator accepts, then whatever
// acceptProposal promotes them to) and non-survivors (type 'idea_candidate',
// archived on write). Their stored embeddings are the novelty gate's memory:
// tomorrow's candidates are compared against them.

export const IDEA_ORIGIN: Origin = { kind: 'kairos', via: 'cron:idea-tournament' }

const SUMMARY_MAX = 240
const TITLE_MAX = 255
const NEIGHBOUR_LIMIT_MAX = 50
const OUTCOME_SCAN_CAP = 500
const DAY_MS = 86_400_000

const ideaField = (key: string) => sql`${memories.sourceMetadata}->'idea'->>${key}`
const hasIdea = sql`jsonb_typeof(${memories.sourceMetadata}->'idea') = 'object'`
const isSurvivor = and(hasIdea, sql`${ideaField('status')} = 'survivor'`)!
const eloSort = sql`(CASE WHEN jsonb_typeof(${memories.sourceMetadata}->'idea'->'elo') = 'number' THEN (${ideaField('elo')})::float8 END) DESC NULLS LAST`

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function usableEmbedding(v: number[] | null | undefined): number[] | null {
  return Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every(Number.isFinite) ? v : null
}

// ── Novelty neighbours ─────────────────────────────────────────────────────

export type IdeaNeighbourKind = 'idea' | 'proposal' | 'belief'

export interface IdeaNeighbour {
  id: string
  kind: IdeaNeighbourKind
  similarity: number
}

// eliminatedReason of a candidate archived because no judge ruled on it (the
// routine and the sweep fallback both failed). Left out of the novelty pool so
// an unjudged idea can come back on a later night.
export const IDEA_JUDGE_FAILED_REASON = 'judge_failed'

// Nearest rows by cosine across the three pools the novelty gate compares
// against: (a) the idea archive, every status INCLUDING archived rows, so a
// dismissed or eliminated idea still blocks its repeat (except candidates no
// judge ruled on); (b) pending,
// unarchived inbound proposals; (c) live held beliefs (both minds). One flat
// `ORDER BY embedding <=> $vec LIMIT n` per pool inside one transaction with
// SET LOCAL hnsw.ef_search (the retrieval idiom: the HNSW index is used and the
// GUC never leaks). HNSW post-filters, so recall on a sparse pool is the pool's
// rows among the ~ef_search nearest overall; the gate only acts on cosine
// ≥ NOVELTY_BORDERLINE_COSINE, which is exactly where that recall is best.
// A row in the archive is tagged 'idea' even when it is also a pending proposal.
export async function findNearestIdeaNeighbours(
  userId: string,
  embedding: number[],
  limit = 5,
): Promise<IdeaNeighbour[]> {
  if (!Array.isArray(embedding) || embedding.length === 0) return []
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), NEIGHBOUR_LIMIT_MAX)
  const distance = sql`${memories.embedding} <=> ${toVectorLiteral(embedding)}::vector`
  const base = [eq(memories.userId, userId), isNotNull(memories.embedding)]
  const pools: Array<{ kind: IdeaNeighbourKind; where: SQL }> = [
    {
      kind: 'idea',
      where: and(...base, hasIdea, sql`${ideaField('eliminatedReason')} IS DISTINCT FROM ${IDEA_JUDGE_FAILED_REASON}`)!,
    },
    {
      kind: 'proposal',
      where: and(
        ...base,
        eq(memories.type, 'inbound'),
        sql`${memories.sourceMetadata}->>'status' = 'pending'`,
        isNull(memories.archivedAt),
        sql`NOT coalesce(${hasIdea}, false)`,
      )!,
    },
    { kind: 'belief', where: and(...base, isBelief, liveHeld)! },
  ]

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
    const out: IdeaNeighbour[] = []
    for (const pool of pools) {
      const hits = await tx
        .select({ id: memories.id, distance: sql<number>`${distance}` })
        .from(memories)
        .where(pool.where)
        .orderBy(distance)
        .limit(n)
      for (const h of hits) {
        const similarity = 1 - Number(h.distance)
        if (Number.isFinite(similarity)) out.push({ id: h.id, kind: pool.kind, similarity })
      }
    }
    return out
  })

  const byId = new Map<string, IdeaNeighbour>()
  for (const r of rows) {
    const prev = byId.get(r.id)
    if (!prev) byId.set(r.id, r)
    else if (r.kind === 'idea') byId.set(r.id, { ...r, similarity: Math.max(r.similarity, prev.similarity) })
  }
  return [...byId.values()].sort((a, b) => b.similarity - a.similarity).slice(0, n)
}

// ── Tournament write ───────────────────────────────────────────────────────

export interface TournamentSurvivorInput {
  title: string
  bodyMd: string
  embedding: number[] | null
  citedIds: string[]
  dominionId: string | null
  meta: IdeaMeta
}

export interface TournamentOtherInput {
  title: string
  bodyMd: string
  embedding: number[] | null
  dominionId: string | null
  meta: IdeaMeta
}

export interface TournamentWriteInput {
  tournamentDate: string
  generateJobId: string
  judgeJobId: string | null
  survivors: TournamentSurvivorInput[]
  others: TournamentOtherInput[]
}

export interface TournamentWriteResult {
  written: boolean
  survivorIds: string[]
  archivedIds: string[]
}

export const tournamentLockKey = (tournamentDate: string) => `idea_tournament:${tournamentDate}`

function embeddingValues(v: number[] | null | undefined) {
  const embedding = usableEmbedding(v)
  return embedding ? { embedding, embeddingModel: activeEmbeddingModel() } : {}
}

// The tournament's identity fields come from the write call, so the
// idempotency probe always matches what was written.
function stampMeta(meta: IdeaMeta, input: TournamentWriteInput, status: IdeaMeta['status']): IdeaMeta {
  return {
    ...meta,
    tournamentDate: input.tournamentDate,
    generateJobId: input.generateJobId,
    judgeJobId: input.judgeJobId,
    status,
  }
}

// One night's whole tournament commits atomically. Idempotent per (user,
// tournamentDate): the advisory lock serialises concurrent writers and the
// probe turns a repeat into written:false with the ids already stored.
// Survivors become pending inbox proposals (kind 'idea', introspection:true,
// so BackUp treats them as candidates needing outside evidence); every other
// candidate is archived on write as a 'trace' row. Both keep their embedding
// (when it is a full-dimension vector) for future novelty checks.
export async function writeTournament(userId: string, input: TournamentWriteInput): Promise<TournamentWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${tournamentLockKey(input.tournamentDate)}))`)
    const existing = await tx
      .select({
        id: memories.id,
        status: sql<string | null>`${ideaField('status')}`,
        key: sql<string | null>`${ideaField('key')}`,
      })
      .from(memories)
      .where(and(eq(memories.userId, userId), hasIdea, sql`${ideaField('tournamentDate')} = ${input.tournamentDate}`))
      .orderBy(memories.createdAt, memories.id)
    if (existing.length > 0) {
      // One write stamps every row with the same createdAt, so restore the
      // caller's order by candidate key (unknown keys last).
      const ordered = (rows: typeof existing, list: Array<{ meta: IdeaMeta }>) => {
        const pos = new Map(list.map((c, i) => [c.meta.key, i]))
        const at = (k: string | null) => pos.get(k ?? '') ?? list.length
        return [...rows].sort((a, b) => at(a.key) - at(b.key)).map((r) => r.id)
      }
      return {
        written: false,
        survivorIds: ordered(existing.filter((r) => r.status === 'survivor'), input.survivors),
        archivedIds: ordered(existing.filter((r) => r.status !== 'survivor'), input.others),
      }
    }

    const now = new Date()
    const survivorIds: string[] = []
    for (const s of input.survivors) {
      const citations = [...new Set(s.citedIds)]
      const meta = stampMeta(s.meta, input, 'survivor')
      const [row] = await tx
        .insert(memories)
        .values({
          userId,
          dominionId: s.dominionId,
          title: s.title.slice(0, TITLE_MAX),
          bodyMd: s.bodyMd,
          summary: meta.survivedBecause ? meta.survivedBecause.slice(0, SUMMARY_MAX) : null,
          type: 'inbound',
          streamClass: 'agentic',
          confidence: confidenceForStreamClass('agentic'),
          source: 'cron',
          sourceMetadata: {
            introspection: true,
            kind: IDEA_PROPOSAL_KIND,
            status: 'pending',
            citations,
            idea: meta,
            origin: IDEA_ORIGIN,
          },
          links: citations.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' as const })),
          tags: ['proposal', IDEA_PROPOSAL_KIND],
          pinned: false,
          ...embeddingValues(s.embedding),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: memories.id })
      if (!row) throw new Error('idea survivor insert returned no row')
      survivorIds.push(row.id)
    }

    const archivedIds: string[] = []
    for (const o of input.others) {
      const status = o.meta.status === 'survivor' ? 'eliminated' : o.meta.status
      const [row] = await tx
        .insert(memories)
        .values({
          userId,
          dominionId: o.dominionId,
          title: o.title.slice(0, TITLE_MAX),
          bodyMd: o.bodyMd,
          type: IDEA_CANDIDATE_TYPE,
          streamClass: 'trace',
          confidence: confidenceForStreamClass('trace'),
          source: 'cron',
          sourceMetadata: { idea: stampMeta(o.meta, input, status), origin: IDEA_ORIGIN },
          pinned: false,
          archivedAt: now,
          ...embeddingValues(o.embedding),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: memories.id })
      if (!row) throw new Error('idea candidate insert returned no row')
      archivedIds.push(row.id)
    }

    return { written: true, survivorIds, archivedIds }
  })
}

// ── Outcomes ───────────────────────────────────────────────────────────────

// A survivor's outcome: the recorded idea.outcome, else inferred for rows the
// operator triaged before recordIdeaOutcome existed. acceptProposal sets
// status 'accepted'; dismissInboxMemory archives and leaves status 'pending'
// (the 'dismissed' status is accepted too). BackUp's decay archives with
// status 'decayed' and its promote sets 'promoted': neither is an operator
// outcome, so both stay null.
export function inferIdeaOutcome(row: { sourceMetadata: unknown; archivedAt: Date | null }): IdeaOutcome | null {
  const meta = asRecord(row.sourceMetadata)
  const recorded = asRecord(meta.idea).outcome
  if (recorded === 'accepted' || recorded === 'dismissed') return recorded
  const status = str(meta.status) ?? 'pending'
  if (status === 'accepted') return 'accepted'
  if (row.archivedAt && (status === 'pending' || status === 'dismissed')) return 'dismissed'
  return null
}

interface SurvivorRow {
  id: string
  title: string
  sourceMetadata: unknown
  archivedAt: Date | null
  createdAt: Date
}

async function listSurvivorRows(userId: string, since: Date): Promise<SurvivorRow[]> {
  return db
    .select({
      id: memories.id,
      title: memories.title,
      sourceMetadata: memories.sourceMetadata,
      archivedAt: memories.archivedAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), isSurvivor, gte(memories.createdAt, since)))
    .orderBy(desc(memories.createdAt))
    .limit(OUTCOME_SCAN_CAP)
}

const daysAgo = (days: number, now = Date.now()) => new Date(now - Math.max(days, 0) * DAY_MS)

export interface IdeaOutcomeRow {
  id: string
  title: string
  direction: string
  claim: string
  outcome: IdeaOutcome
}

// Survivors created in the last `sinceDays` days that have an outcome
// (recorded or inferred), newest first.
export async function listIdeaOutcomes(userId: string, sinceDays = 30): Promise<IdeaOutcomeRow[]> {
  const rows = await listSurvivorRows(userId, daysAgo(sinceDays))
  return rows.flatMap((r) => {
    const outcome = inferIdeaOutcome(r)
    if (!outcome) return []
    const idea = asRecord(asRecord(r.sourceMetadata).idea)
    return [{ id: r.id, title: r.title, direction: str(idea.direction) ?? '', claim: str(idea.claim) ?? '', outcome }]
  })
}

export interface DirectionStat {
  direction: string
  survivors: number
  accepted: number
  dismissed: number
}

// Per-direction survivor counts and outcomes over survivors created in the
// last `sinceDays` days; most survivors first, then by name.
export async function listDirectionStats(userId: string, sinceDays = 60): Promise<DirectionStat[]> {
  const rows = await listSurvivorRows(userId, daysAgo(sinceDays))
  const stats = new Map<string, DirectionStat>()
  for (const r of rows) {
    const direction = str(asRecord(asRecord(r.sourceMetadata).idea).direction) ?? ''
    const s = stats.get(direction) ?? { direction, survivors: 0, accepted: 0, dismissed: 0 }
    s.survivors++
    const outcome = inferIdeaOutcome(r)
    if (outcome === 'accepted') s.accepted++
    if (outcome === 'dismissed') s.dismissed++
    stats.set(direction, s)
  }
  return [...stats.values()].sort((a, b) => b.survivors - a.survivors || a.direction.localeCompare(b.direction))
}

// Stamps idea.outcome / idea.outcomeAt in one atomic jsonb_set UPDATE. Found
// by id (not type), so it still works after acceptProposal retyped the row.
// False when the row is missing, not the user's, or carries no idea meta.
export async function recordIdeaOutcome(
  userId: string,
  memoryId: string,
  outcome: IdeaOutcome,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(jsonb_set(${memories.sourceMetadata}, '{idea,outcome}', to_jsonb(${outcome}::text)), '{idea,outcomeAt}', to_jsonb(${now.toISOString()}::text))`,
      updatedAt: now,
    })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), hasIdea))
    .returning({ id: memories.id })
  return updated.length > 0
}

// ── Survivor reads ─────────────────────────────────────────────────────────

export interface SurvivorView {
  id: string
  title: string
  claim: string
  survivedBecause: string | null
  elo: number | null
  direction: string
  tournamentDate: string
  // The proposal's status (pending / accepted / promoted / decayed …);
  // 'dismissed' for an archived row still marked pending.
  status: string
  createdAt: Date
}

// Survivors created since `since`, whatever happened to them later; highest
// Elo first, then newest.
export async function listSurvivorsSince(userId: string, since: Date, limit = 5): Promise<SurvivorView[]> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      sourceMetadata: memories.sourceMetadata,
      archivedAt: memories.archivedAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), isSurvivor, gte(memories.createdAt, since)))
    .orderBy(eloSort, desc(memories.createdAt))
    .limit(Math.min(Math.max(Math.trunc(limit) || 1, 1), 50))
  return rows.map((r) => {
    const meta = asRecord(r.sourceMetadata)
    const idea = asRecord(meta.idea)
    const raw = str(meta.status) ?? 'pending'
    return {
      id: r.id,
      title: r.title,
      claim: str(idea.claim) ?? '',
      survivedBecause: str(idea.survivedBecause),
      elo: typeof idea.elo === 'number' && Number.isFinite(idea.elo) ? idea.elo : null,
      direction: str(idea.direction) ?? '',
      tournamentDate: str(idea.tournamentDate) ?? '',
      status: r.archivedAt && raw === 'pending' ? 'dismissed' : raw,
      createdAt: r.createdAt,
    }
  })
}

// Embeddings of survivors created in [from, to), for the diversity metric.
// Survivors without a stored embedding are skipped.
export async function listSurvivorEmbeddingsBetween(
  userId: string,
  from: Date,
  to: Date,
): Promise<Array<{ id: string; embedding: number[] }>> {
  const rows = await db
    .select({ id: memories.id, embedding: memories.embedding })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isSurvivor,
      gte(memories.createdAt, from),
      lt(memories.createdAt, to),
      isNotNull(memories.embedding),
    ))
    .orderBy(memories.createdAt)
    .limit(OUTCOME_SCAN_CAP)
  return rows.flatMap((r) =>
    Array.isArray(r.embedding) && r.embedding.length > 0 ? [{ id: r.id, embedding: r.embedding }] : [],
  )
}
