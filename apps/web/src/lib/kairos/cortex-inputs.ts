import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { validAsOfNow } from '@/lib/data/memories'
import {
  cortexOutSchema,
  type ArchetypeRow,
  type PriorCortexRow,
  type ReflectionRow,
} from './cortex-prompt'
import { collectFinishedTitles } from './board-feed-render'
import { inDominionScope } from './retrieve'

const MAX_REFLECTIONS = 30
const MAX_ARCHETYPES = 12

// "Today so far" grounding (C) — the day being consolidated. Cortex runs at
// 03:00Z, so "today" has barely started; the day it is actually folding is
// the PREVIOUS UTC day. Read that day's micro-consolidation deltas (chronological),
// else a lightweight new-memory count for the same window. Best-effort: a null
// return just omits the prompt section.
const MAX_DAY_DELTAS = 6

export function previousUtcDay(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
}

export async function fetchTodaySoFar(userId: string, dominionId: string, day: string): Promise<string | null> {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)
  const inDay = and(gte(memories.createdAt, dayStart), lt(memories.createdAt, dayEnd))
  const base = await fetchDayDeltasOrCount(userId, dominionId, day, inDay)
  const finished = await fetchWatchedBoardFinished(userId, dominionId, inDay)
  if (finished.length === 0) return base
  const line = `Finished on watched boards: ${finished.join('; ')}`
  return base ? `${base}\n\n${line}` : line
}

// Watched-board cards finished that day (same-day board_card_done rows + the
// nightly board_day page), titles only, bounded — so area summaries learn from the board.
const MAX_FINISHED_ROWS = 40

async function fetchWatchedBoardFinished(userId: string, dominionId: string, inDay: ReturnType<typeof and>): Promise<string[]> {
  const rows = await db
    .select({ sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' IN ('board_card_done', 'board_day')`,
      inDay,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_FINISHED_ROWS)
  return collectFinishedTitles(rows.map((r) => r.sourceMetadata))
}

async function fetchDayDeltasOrCount(userId: string, dominionId: string, day: string, inDay: ReturnType<typeof and>): Promise<string | null> {
  const deltaRows = await db
    .select({ bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'delta'),
      isNull(memories.archivedAt),
      inDay,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_DAY_DELTAS)
  if (deltaRows.length > 0) return deltaRows.map((r) => r.bodyMd).reverse().join('\n\n---\n\n')

  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      isNull(memories.archivedAt),
      sql`${memories.streamClass} NOT IN ('trace', 'delta')`,
      inDay,
    ))
  const n = countRow?.n ?? 0
  return n > 0 ? `${n} new ${n === 1 ? 'memory' : 'memories'} captured on ${day}.` : null
}

export async function fetchCortexInputs(
  userId: string,
  dominionId: string,
): Promise<{ reflections: ReflectionRow[]; archetypes: ArchetypeRow[]; prior: PriorCortexRow | null }> {
  const baseScope = and(
    eq(memories.userId, userId),
    eq(memories.dominionId, dominionId),
    isNull(memories.archivedAt),
    validAsOfNow,
  )
  const reflectionScope = and(
    eq(memories.userId, userId),
    inDominionScope(dominionId),
    isNull(memories.archivedAt),
    validAsOfNow,
  )

  const [reflectionRows, archetypeRows, priorRows] = await Promise.all([
    db.select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      createdAt: memories.createdAt,
    })
      .from(memories)
      .where(and(reflectionScope, eq(memories.streamClass, 'reflection')))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_REFLECTIONS),

    db.select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(baseScope, eq(memories.streamClass, 'archetype')))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_ARCHETYPES),

    // Prior cortex — take the most recent row regardless of archive state.
    // We rely on alreadyRanToday() to guarantee no live cortex for today
    // exists at this point, so the most-recent row is always yesterday's
    // (or older). If we filtered on archivedAt here, a first-ever regen
    // would correctly return null, but so does this query (LIMIT 1 → []).
    db.select({
      id: memories.id,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.dominionId, dominionId),
        eq(memories.streamClass, 'cortex'),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(1),
  ])

  const reflections: ReflectionRow[] = reflectionRows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: r.createdAt,
  }))

  const archetypes: ArchetypeRow[] = archetypeRows.map((a) => {
    const meta = (a.sourceMetadata ?? {}) as Record<string, unknown>
    const themes = Array.isArray(meta.themes) ? (meta.themes as unknown[]).filter((t): t is string => typeof t === 'string') : []
    return { id: a.id, title: a.title, summary: a.summary, themes }
  })

  const priorRow = priorRows[0]
  let prior: PriorCortexRow | null = null
  if (priorRow) {
    const meta = (priorRow.sourceMetadata ?? {}) as Record<string, unknown>
    const candidate = meta.cortex
    const parsed = candidate ? cortexOutSchema.safeParse(candidate) : null
    // Visibility on schema drift: a prior cortex that fails the current
    // schema yields payload=null, which renders as "no prior cortex" in
    // the prompt and silently zeroes recent_shifts. Warn so it shows up
    // in cron logs instead of being indistinguishable from a first regen.
    if (parsed && !parsed.success) {
      console.warn(
        `[kairos:cortex] prior cortex row ${priorRow.id} failed schema — recent_shifts will be empty.`,
        parsed.error.issues.slice(0, 3),
      )
    }
    prior = {
      id: priorRow.id,
      createdAt: priorRow.createdAt,
      payload: parsed?.success ? parsed.data : null,
    }
  }

  return { reflections, archetypes, prior }
}
