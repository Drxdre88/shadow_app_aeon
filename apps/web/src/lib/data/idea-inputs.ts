import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { listBeliefs } from '@/lib/data/beliefs'
import { originKindSqlOf } from '@/lib/data/belief-inputs'
import { findDominionsByUser, listDominionObjectives } from '@/lib/data/dominions'
import { validAsOfNow } from '@/lib/data/memories'
import { originKindOf, type OriginKind } from '@/lib/kairos/origin'

// Idea-tournament inputs (docs/kairos/35): bounded, read-only reads that feed
// the nightly idea_generate prompt, plus evidence snippets for the judge.
// Pure DB — shaping and caps for the prompt live in lib/kairos/ideas/.

const DAY_MS = 86_400_000
const EXCERPT_CHARS = 1200
const SNIPPET_CHARS = 600

export const IDEA_BOARD_DAYS = 3
export const IDEA_BOARD_PAGE_CAP = 9
export const IDEA_BELIEF_CAP = 20
export const IDEA_CONCEPT_CAP = 10
export const IDEA_REFLECTION_DAYS = 7
export const IDEA_REFLECTION_CAP = 15

const live = [isNull(memories.archivedAt), isNull(memories.supersededAt), validAsOfNow] as const
const originKindSql = originKindSqlOf(sql`${memories.source}`, sql`${memories.sourceMetadata}`)
const excerpt = (n: number) => sql<string | null>`left(${memories.bodyMd}, ${n})`

export interface IdeaDominion {
  id: string
  name: string
}

export interface IdeaObjective {
  dominionId: string
  title: string
  status: string
  targetDate: Date | null
}

export interface IdeaAetherRow {
  id: string
  createdAt: Date
  // sourceMetadata.aether (AetherPayload), unvalidated.
  payload: unknown
}

export interface IdeaTextRow {
  id: string
  title: string
  summary: string | null
  excerpt: string | null
  dominionId: string | null
  createdAt: Date
}

export interface IdeaBeliefRow {
  id: string
  mind: string
  domain: string
  claim: string
  dominionId: string | null
}

export async function listActiveDominions(userId: string): Promise<IdeaDominion[]> {
  return (await findDominionsByUser(userId)).filter((d) => !d.archivedAt).map((d) => ({ id: d.id, name: d.name }))
}

export async function listOpenObjectives(userId: string, dominions: readonly IdeaDominion[]): Promise<IdeaObjective[]> {
  const perDominion = await Promise.all(dominions.map((d) => listDominionObjectives(d.id, userId)))
  return perDominion.flatMap((rows, i) =>
    rows
      .filter((o) => o.status === 'active' || o.status === 'paused')
      .map((o) => ({ dominionId: dominions[i].id, title: o.title, status: o.status, targetDate: o.targetDate ?? null })))
}

export async function getLatestAether(userId: string): Promise<IdeaAetherRow | null> {
  const [row] = await db
    .select({ id: memories.id, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.streamClass, 'aether'), ...live))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const meta = row.sourceMetadata as Record<string, unknown> | null
  return { id: row.id, createdAt: row.createdAt, payload: meta?.aether ?? null }
}

const textColumns = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  excerpt: excerpt(EXCERPT_CHARS),
  dominionId: memories.dominionId,
  createdAt: memories.createdAt,
}

// board_day feed pages (finished / started / created cards) of the last days.
export async function listRecentBoardDays(userId: string, now: Date, days = IDEA_BOARD_DAYS, limit = IDEA_BOARD_PAGE_CAP): Promise<IdeaTextRow[]> {
  return db
    .select(textColumns)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->>'kind' = 'board_day'`,
      gte(memories.createdAt, new Date(now.getTime() - days * DAY_MS)),
      ...live,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
}

// Live distilled concepts (not pending concept proposals), newest first.
export async function listRecentConcepts(userId: string, limit = IDEA_CONCEPT_CAP): Promise<IdeaTextRow[]> {
  return db
    .select(textColumns)
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.streamClass, 'concept'), eq(memories.type, 'concept'), ...live))
    .orderBy(desc(memories.updatedAt))
    .limit(limit)
}

// The operator's own reflections (origin operator) of the last days.
export async function listOperatorReflections(userId: string, now: Date, days = IDEA_REFLECTION_DAYS, limit = IDEA_REFLECTION_CAP): Promise<IdeaTextRow[]> {
  return db
    .select(textColumns)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`(${memories.streamClass} = 'reflection' OR ${memories.type} = 'reflection')`,
      sql`${originKindSql} = 'operator'`,
      gte(memories.createdAt, new Date(now.getTime() - days * DAY_MS)),
      ...live,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
}

// Held beliefs of both minds, weightiest first.
export async function listTopHeldBeliefs(userId: string, limit = IDEA_BELIEF_CAP): Promise<IdeaBeliefRow[]> {
  const rows = await listBeliefs(userId, { status: 'held', rank: 'standing', limit })
  return rows.map((b) => ({ id: b.id, mind: b.mind, domain: b.domain, claim: b.claim, dominionId: b.dominionId }))
}

export interface IdeaEvidenceSnippet {
  id: string
  title: string
  text: string
  dominionId: string | null
  origin: OriginKind
  // sourceMetadata.kind (e.g. 'idea', 'board_day'); null when absent.
  kind: string | null
  type: string
}

// Rows by id with a short text and their origin. Default live only (archived,
// superseded or invalid rows are absent) — the judge's evidence. `liveOnly:
// false` also reads archived rows: the nearest earlier idea for borderline
// novelty is usually an archived candidate.
export async function listEvidenceSnippets(
  userId: string,
  ids: readonly string[],
  opts: { liveOnly?: boolean } = {},
): Promise<IdeaEvidenceSnippet[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const conds: SQL[] = [eq(memories.userId, userId), inArray(memories.id, unique)]
  if (opts.liveOnly ?? true) conds.push(...live)
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      excerpt: excerpt(SNIPPET_CHARS),
      dominionId: memories.dominionId,
      source: memories.source,
      sourceMetadata: memories.sourceMetadata,
      type: memories.type,
    })
    .from(memories)
    .where(and(...conds))
  return rows.map((r) => {
    const meta = r.sourceMetadata as Record<string, unknown> | null
    const kind = typeof meta?.kind === 'string' ? meta.kind : null
    return {
      id: r.id,
      title: r.title,
      text: (r.summary?.trim() || r.excerpt?.trim() || '').slice(0, SNIPPET_CHARS),
      dominionId: r.dominionId,
      origin: originKindOf({ source: r.source, sourceMetadata: r.sourceMetadata }),
      kind,
      type: r.type,
    }
  })
}
