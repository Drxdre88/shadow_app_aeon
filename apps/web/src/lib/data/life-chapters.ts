import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { CONSTITUTION_TYPE } from '@/lib/kairos/constitution/schema'
import { GOAL_ORIGIN_VIA, readGoalMeta } from '@/lib/kairos/goals/parse'
import {
  LIFE_CHAPTER_LIST_MAX,
  lifeChapterMetaSchema,
  type LifeChapterMeta,
  type LifeChapterView,
} from '@/lib/data/validators/kairos-life-chapters'

// Life-chapter trace rows (KAIROS_LIFE_CHAPTERS) and the month readers the
// life_chapter job gathers from. A chapter is type 'observation', streamClass
// 'trace' (out of Aether's pool, the owner's memory list and reflect events),
// sourceMetadata { kind:'life_chapter', externalKey:'life_chapter:YYYY-MM',
// chapter:{…} } — never a top-level `reason` (the weekly review's health
// section would count it as a cron failure). Pure DB access, user-scoped.

export const LIFE_CHAPTER_OBSERVATION_KIND = 'life_chapter'
export const WEEKLY_REVIEW_OBSERVATION_KIND = 'weekly_review'

export const lifeChapterExternalKey = (month: string) => `life_chapter:${month}`

const chapterMonth = sql`${memories.sourceMetadata}->'chapter'->>'month'`

const chapterWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'observation'),
  eq(memories.streamClass, 'trace'),
  isNull(memories.archivedAt),
  sql`${memories.sourceMetadata}->>'kind' = ${LIFE_CHAPTER_OBSERVATION_KIND}`,
)

export interface LifeChapterValues {
  month: string
  title: string
  bodyMd: string
  summary: string
  chapter: LifeChapterMeta
}

export interface LifeChapterRow {
  id: string
  externalKey: string
  chapter: LifeChapterMeta | null
  createdAt: Date
}

const ROW_COLUMNS = { id: memories.id, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt }

function toRow(r: { id: string; sourceMetadata: unknown; createdAt: Date }): LifeChapterRow {
  const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>
  const parsed = lifeChapterMetaSchema.safeParse(meta.chapter)
  return {
    id: r.id,
    externalKey: typeof meta.externalKey === 'string' ? meta.externalKey : '',
    chapter: parsed.success ? parsed.data : null,
    createdAt: r.createdAt,
  }
}

export async function findLifeChapter(userId: string, month: string): Promise<LifeChapterRow | null> {
  const [row] = await db
    .select(ROW_COLUMNS)
    .from(memories)
    .where(and(chapterWhere(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${lifeChapterExternalKey(month)}`))
    .limit(1)
  return row ? toRow(row) : null
}

// Idempotent per month (advisory lock + existence check in one transaction):
// a re-submitted job returns the first row.
export async function insertLifeChapter(
  userId: string,
  values: LifeChapterValues,
): Promise<{ memoryId: string; written: boolean }> {
  const externalKey = lifeChapterExternalKey(values.month)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(chapterWhere(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${externalKey}`))
      .limit(1)
    if (existing) return { memoryId: existing.id, written: false }
    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary.slice(0, 240),
        type: 'observation',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: [LIFE_CHAPTER_OBSERVATION_KIND],
        sourceMetadata: { kind: LIFE_CHAPTER_OBSERVATION_KIND, externalKey, chapter: values.chapter },
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('life chapter insert returned no row')
    return { memoryId: inserted.id, written: true }
  })
}

// Newest month first; `month` narrows to that one chapter.
export async function listLifeChapters(userId: string, opts: { month?: string; limit?: number } = {}): Promise<LifeChapterRow[]> {
  const rows = await db
    .select(ROW_COLUMNS)
    .from(memories)
    .where(and(chapterWhere(userId), ...(opts.month ? [sql`${chapterMonth} = ${opts.month}`] : [])))
    .orderBy(desc(chapterMonth), desc(memories.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 3, 1), LIFE_CHAPTER_LIST_MAX))
  return rows.map(toRow)
}

// The newest chapter for a month strictly before `month` (YYYY-MM sorts as text).
export async function findLatestLifeChapterBefore(userId: string, month: string): Promise<LifeChapterRow | null> {
  const [row] = await db
    .select(ROW_COLUMNS)
    .from(memories)
    .where(and(chapterWhere(userId), sql`${chapterMonth} < ${month}`))
    .orderBy(desc(chapterMonth), desc(memories.createdAt))
    .limit(1)
  return row ? toRow(row) : null
}

export function toLifeChapterView(row: LifeChapterRow): LifeChapterView | null {
  const c = row.chapter
  if (!c) return null
  return {
    id: row.id,
    month: c.month,
    title: c.title,
    summary: c.summary,
    turningPoints: c.turningPoints,
    whatChanged: c.whatChanged,
    unresolved: c.unresolved,
    citations: c.citations,
    createdAt: row.createdAt.toISOString(),
  }
}

// ── Month readers (inputs to the life_chapter job) ────────────────────────

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

export interface MonthReviewRow { id: string; isoWeek: string; summary: string; wins: string[]; drift: string[] }

// Weekly reviews whose window overlaps [start, end).
export async function listWeeklyReviewsOverlapping(userId: string, start: Date, end: Date, limit: number): Promise<MonthReviewRow[]> {
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = ${WEEKLY_REVIEW_OBSERVATION_KIND}`,
      sql`(${memories.sourceMetadata}->'window'->>'start')::timestamptz < ${ts(end)}`,
      sql`(${memories.sourceMetadata}->'window'->>'end')::timestamptz > ${ts(start)}`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows.map((r) => {
    const m = asRecord(r.sourceMetadata)
    return {
      id: r.id,
      isoWeek: typeof m.isoWeek === 'string' ? m.isoWeek : '',
      summary: typeof m.summary === 'string' ? m.summary : '',
      wins: strings(m.wins),
      drift: strings(m.drift),
    }
  })
}

export interface MonthGoalRow { id: string; title: string; state: string; at: string }

const goalTime = (key: string) => sql`(${memories.sourceMetadata}->'goal'->>${key})::timestamptz`
const goalIn = (key: string, start: Date, end: Date) => and(sql`${goalTime(key)} >= ${ts(start)}`, sql`${goalTime(key)} < ${ts(end)}`)

// goal_propose goals proposed, decided or closed inside [start, end).
export async function listGoalsTouchedBetween(userId: string, start: Date, end: Date, limit: number): Promise<MonthGoalRow[]> {
  const rows = await db
    .select({ id: memories.id, title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`jsonb_typeof(${memories.sourceMetadata}->'goal') = 'object'`,
      sql`${memories.sourceMetadata}->'origin'->>'via' = ${GOAL_ORIGIN_VIA}`,
      or(goalIn('proposedAt', start, end), goalIn('decidedAt', start, end), goalIn('closedAt', start, end)),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows.flatMap((r) => {
    const meta = readGoalMeta(r.sourceMetadata)
    if (!meta) return []
    const at = meta.closedAt ?? meta.decidedAt ?? meta.proposedAt
    return [{ id: r.id, title: r.title, state: meta.state, at }]
  })
}

export interface MonthConstitutionRow { id: string; title: string; at: Date }

// Constitution versions created (seeded or accepted) inside [start, end).
export async function listConstitutionVersionsBetween(userId: string, start: Date, end: Date, limit: number): Promise<MonthConstitutionRow[]> {
  const rows = await db
    .select({ id: memories.id, title: memories.title, at: memories.createdAt })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, CONSTITUTION_TYPE),
      eq(memories.streamClass, 'constitution'),
      gte(memories.createdAt, start),
      lt(memories.createdAt, end),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows
}

export interface AetherNarrativeRow { id: string; narrative: string; at: Date }

// The newest Aether written before `at` (its core narrative only).
export async function findAetherNarrativeBefore(userId: string, at: Date): Promise<AetherNarrativeRow | null> {
  const [row] = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, at: memories.createdAt })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.type, 'aether'), lt(memories.createdAt, at)))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const narrative = asRecord(asRecord(row.sourceMetadata).aether).coreNarrative
  return typeof narrative === 'string' && narrative.trim() ? { id: row.id, narrative, at: row.at } : null
}
