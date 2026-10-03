import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { noveltyEvery, noveltyMode, tasteMode } from '@/lib/kairos/ideas/stepping/flag'
import { STEPPING_STONES_MAX } from '@/lib/kairos/ideas/stepping/novelty-prompt'
import { nextNoveltyNight } from '@/lib/kairos/ideas/stepping/schedule'
import { toSteppingStone, type SteppingStone } from '@/lib/kairos/ideas/stepping/stones'
import { TASTE_WINDOW_DAYS, computeIdeaTaste, type IdeaTasteProfile } from '@/lib/kairos/ideas/stepping/taste'
import type { IdeaArchiveCounts, IdeaTasteView } from '@/lib/kairos/ideas/stepping/taste-render'
import { listActiveDominions } from './idea-inputs'

// Lane D idea-archive reads (stepping stones, taste rows) and the one outcomeBy stamp. Pure DB.

const DAY_MS = 86_400_000
const STONES_WINDOW_DAYS = 180
const TASTE_SCAN_CAP = 500
const STONE_OVERFETCH = 4

const ideaField = (key: string) => sql`${memories.sourceMetadata}->'idea'->>${key}`
const hasIdea = sql`jsonb_typeof(${memories.sourceMetadata}->'idea') = 'object'`
const statusIs = (s: string) => sql`${ideaField('status')} = ${s}`
const STONE_REASONS = sql`('ungrounded', 'contradicted', 'already_known', 'not_different', 'ranked_out')`
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS)

// Archived dismissed / eliminated / ignored ideas, in a fixed per-night shuffle (md5 of id + day).
export async function listSteppingStones(
  userId: string,
  day: string,
  now: Date = new Date(),
  limit: number = STEPPING_STONES_MAX,
): Promise<SteppingStone[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), STEPPING_STONES_MAX)
  const rows = await db
    .select({
      title: memories.title,
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
      archivedAt: memories.archivedAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      hasIdea,
      isNotNull(memories.archivedAt),
      gte(memories.createdAt, daysBefore(now, STONES_WINDOW_DAYS)),
      sql`(${statusIs('survivor')} OR (${statusIs('eliminated')} AND ${ideaField('eliminatedReason')} IN ${STONE_REASONS}))`,
    ))
    .orderBy(sql`md5(${memories.id}::text || ${day})`)
    .limit(n * STONE_OVERFETCH)
  return rows.flatMap((r) => {
    const stone = toSteppingStone(r, now)
    return stone ? [stone] : []
  }).slice(0, n)
}

export async function countIdeaArchive(userId: string, now: Date = new Date()): Promise<IdeaArchiveCounts> {
  const outcome = ideaField('outcome')
  const proposalStatus = sql`coalesce(${memories.sourceMetadata}->>'status', 'pending')`
  const [row] = await db
    .select({
      eliminated: sql<number>`count(*) filter (where ${statusIs('eliminated')} and ${ideaField('eliminatedReason')} in ${STONE_REASONS})::int`,
      dismissed: sql<number>`count(*) filter (where ${statusIs('survivor')} and (${outcome} = 'dismissed' or (${outcome} is null and ${proposalStatus} in ('pending', 'dismissed'))))::int`,
      ignored: sql<number>`count(*) filter (where ${statusIs('survivor')} and ${outcome} is null and ${proposalStatus} = 'decayed')::int`,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      hasIdea,
      isNotNull(memories.archivedAt),
      gte(memories.createdAt, daysBefore(now, STONES_WINDOW_DAYS)),
    ))
  const eliminated = Number(row?.eliminated ?? 0)
  const dismissed = Number(row?.dismissed ?? 0)
  const ignored = Number(row?.ignored ?? 0)
  return { stones: eliminated + dismissed + ignored, dismissed, eliminated, ignored }
}

export interface IdeaTasteRow {
  dominionId: string | null
  sourceMetadata: unknown
  archivedAt: Date | null
  createdAt: Date
}

// Survivors in the taste window, newest first.
export async function listIdeaTasteRows(userId: string, since: Date): Promise<IdeaTasteRow[]> {
  return db
    .select({
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
      archivedAt: memories.archivedAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), hasIdea, statusIs('survivor'), gte(memories.createdAt, since)))
    .orderBy(desc(memories.createdAt))
    .limit(TASTE_SCAN_CAP)
}

export async function readIdeaTasteProfile(userId: string, now: Date = new Date()): Promise<IdeaTasteProfile> {
  const [rows, dominions] = await Promise.all([
    listIdeaTasteRows(userId, daysBefore(now, TASTE_WINDOW_DAYS)),
    listActiveDominions(userId),
  ])
  return computeIdeaTaste(rows, now, new Map(dominions.map((d) => [d.id, d.name])))
}

export async function readIdeaTaste(userId: string, now: Date = new Date()): Promise<IdeaTasteView> {
  const [profile, archive] = await Promise.all([readIdeaTasteProfile(userId, now), countIdeaArchive(userId, now)])
  const novelty = noveltyMode()
  return {
    mode: { taste: tasteMode(), novelty },
    noveltyEvery: noveltyEvery(),
    nextNoveltyNight: novelty === 'off' ? null : nextNoveltyNight(now),
    profile,
    archive,
  }
}

// Stamps idea.outcomeBy in one atomic jsonb_set; false when the row is missing or has no idea meta.
export async function stampIdeaOutcomeBy(userId: string, memoryId: string, by: 'operator' | 'agent'): Promise<boolean> {
  const updated = await db
    .update(memories)
    .set({ sourceMetadata: sql`jsonb_set(${memories.sourceMetadata}, '{idea,outcomeBy}', to_jsonb(${by}::text))` })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), hasIdea))
    .returning({ id: memories.id })
  return updated.length > 0
}
