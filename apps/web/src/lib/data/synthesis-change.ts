import { and, eq, gt, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories } from '@/lib/db/schema'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import { inDominionScope } from '@/lib/kairos/retrieve'

// Change-check reads for the nightly synthesis (archetypes, cortex, aether).
// Pure DB access: lib/kairos/synthesis-change.ts decides run vs skip.
//
// An archetype kept in place by a run is stamped sourceMetadata.confirmedAt;
// one edited in place is also stamped revisedAt. An archetype's "last run" is
// therefore the later of its createdAt and confirmedAt.

export const ARCHETYPE_CONFIRMED_KEY = 'confirmedAt'
export const ARCHETYPE_REVISED_KEY = 'revisedAt'

const SYNTHESIS_CLASSES = ['archetype', 'cortex', 'aether'] as const

export const archetypeRunStamp = sql`GREATEST(${memories.createdAt}, COALESCE((${memories.sourceMetadata}->>'confirmedAt')::timestamp, ${memories.createdAt}))`

export async function latestArchetypeRunAt(userId: string, dominionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`MAX(${archetypeRunStamp})`.mapWith(memories.createdAt) })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
    ))
  return row?.at ?? null
}

export async function latestLiveCreatedAt(userId: string, streamClass: 'cortex' | 'aether', dominionId: string | null): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`MAX(${memories.createdAt})`.mapWith(memories.createdAt) })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, streamClass),
      isNull(memories.archivedAt),
      dominionId ? eq(memories.dominionId, dominionId) : undefined,
    ))
  return row?.at ?? null
}

export async function countFreshInputs(userId: string, dominionId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      notInArray(memories.streamClass, [...SYNTHESIS_CLASSES, ...META_STREAM_CLASSES]),
      or(eq(memories.dominionId, dominionId), and(eq(memories.streamClass, 'reflection'), inDominionScope(dominionId))),
      gt(memories.createdAt, since),
    ))
  return row?.n ?? 0
}

export async function countArchetypeChangesSince(userId: string, dominionId: string, since: Date): Promise<number> {
  const at = since.toISOString()
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'archetype'),
      sql`(${memories.createdAt} > ${at}::timestamp
        OR (${memories.sourceMetadata}->>'revisedAt')::timestamp > ${at}::timestamp
        OR ${memories.archivedAt} > ${at}::timestamp)`,
    ))
  return row?.n ?? 0
}

export async function countRowsCreatedSince(userId: string, streamClass: 'cortex', since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.streamClass, streamClass), gt(memories.createdAt, since)))
  return row?.n ?? 0
}

export async function dominionUpdatedAt(userId: string, dominionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: dominions.updatedAt })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  return row?.at ?? null
}
