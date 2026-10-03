import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { mayShapeBeliefsSql } from '@/lib/data/belief-inputs'
import { validAsOfNow } from '@/lib/data/memories'

export interface DreamCandidateRow {
  id: string
  dominionId: string | null
  streamClass: string
  title: string
  summary: string | null
  createdAt: Date
  embedding: number[]
}

// Dream candidates (spec_dreams §Picking 1). Pure DB, one query: live rows with
// an embedding from the owner's own streams (never proposals, never external
// content), at most 10 per area in an order shuffled by the night's date, 80
// in all. The same date gives the same rows.

export const DREAM_STREAM_CLASSES = ['reflection', 'idea', 'agentic', 'concept'] as const
export const DREAM_PER_AREA = 10
export const DREAM_CANDIDATE_CAP = 80

function toVector(value: unknown): number[] | null {
  const v = typeof value === 'string' ? safeJson(value) : value
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : null
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export async function listDreamCandidates(userId: string, date: string): Promise<DreamCandidateRow[]> {
  const shuffle = sql`md5(${memories.id}::text || ${date})`
  const ranked = db
    .select({
      id: memories.id,
      dominionId: memories.dominionId,
      streamClass: memories.streamClass,
      title: memories.title,
      aiTitle: memories.aiTitle,
      summary: memories.summary,
      createdAt: memories.createdAt,
      embedding: memories.embedding,
      rn: sql<number>`row_number() over (partition by ${memories.dominionId} order by ${shuffle})`.as('rn'),
      shuffle: sql<string>`${shuffle}`.as('shuffle'),
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
      validAsOfNow,
      isNotNull(memories.embedding),
      inArray(memories.streamClass, [...DREAM_STREAM_CLASSES]),
      ne(memories.type, 'inbound'),
      mayShapeBeliefsSql,
    ))
    .as('dream_ranked')

  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rn, DREAM_PER_AREA))
    .orderBy(asc(ranked.rn), asc(ranked.shuffle))
    .limit(DREAM_CANDIDATE_CAP)

  return rows.flatMap((r) => {
    const embedding = toVector(r.embedding)
    if (!embedding) return []
    return [{
      id: r.id,
      dominionId: r.dominionId,
      streamClass: r.streamClass,
      title: r.aiTitle?.trim() || r.title,
      summary: r.summary,
      createdAt: new Date(r.createdAt),
      embedding,
    }]
  })
}
