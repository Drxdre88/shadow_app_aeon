import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { findDriftObservation, type DriftObservationRow } from '@/lib/data/constitution-drift'

// Character check reads (Lane B). Pure DB access, user-scoped, read only —
// except the run row itself, which goes through insertDriftObservation
// (kind 'character_run', streamClass 'trace': kept out of retrieval and every
// Kairos prompt).

export const CHARACTER_RUN_KIND = 'character_run' as const
export const characterRunKey = (isoWeek: string) => `character_run:${isoWeek}`

const REFLECTION_SCAN = 120
const DAILY_SCAN = 14
const DAILY_PREFIX = 'kairos-daily:'

export interface CharacterReflectionRow {
  id: string
  text: string
  // sourceMetadata.tone.flagged (absent on reflections written before the tone budget).
  toneFlagged: boolean
}

// Hourly reflections in [start, end) — both streams, so quarantined
// ('trace') reflections still count.
export async function listReflectionsBetween(userId: string, start: Date, end: Date): Promise<CharacterReflectionRow[]> {
  const rows = await db
    .select({ id: memories.id, bodyMd: memories.bodyMd, summary: memories.summary, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = 'reflection'`,
      sql`${memories.tags} @> '["reflection"]'::jsonb`,
      gte(memories.createdAt, start),
      lt(memories.createdAt, end),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(REFLECTION_SCAN)
  return rows.map((r) => {
    const tone = (r.sourceMetadata as Record<string, unknown> | null)?.tone as Record<string, unknown> | undefined
    return { id: r.id, text: r.summary || r.bodyMd, toneFlagged: tone?.flagged === true }
  })
}

export interface CharacterTextRow {
  id: string
  text: string
}

// 06:00 messages Kairos sent in [start, end).
export async function listDailyMessagesBetween(userId: string, start: Date, end: Date): Promise<CharacterTextRow[]> {
  const rows = await db
    .select({ id: memories.id, bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      sql`${memories.sourceMetadata}->>'externalId' like ${`${DAILY_PREFIX}%`}`,
      gte(memories.createdAt, start),
      lt(memories.createdAt, end),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(DAILY_SCAN)
  return rows.map((r) => ({ id: r.id, text: r.bodyMd }))
}

// The newest weekly-review summary written before `before`.
export async function findLatestWeeklyReviewSummary(userId: string, before: Date): Promise<CharacterTextRow | null> {
  const [row] = await db
    .select({ id: memories.id, summary: memories.summary, bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = 'weekly_review'`,
      lt(memories.createdAt, before),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? { id: row.id, text: row.summary || row.bodyMd } : null
}

export async function findCharacterRun(userId: string, isoWeek: string): Promise<DriftObservationRow | null> {
  return findDriftObservation(userId, CHARACTER_RUN_KIND, characterRunKey(isoWeek))
}

// The run time series, newest first.
export async function listCharacterRuns(userId: string, limit = 8): Promise<DriftObservationRow[]> {
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      eq(memories.streamClass, 'trace'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = ${CHARACTER_RUN_KIND}`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 52))
  return rows.map((r) => ({ id: r.id, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>, createdAt: r.createdAt }))
}
