import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, thinkingJobs } from '@/lib/db/schema'
import { mayShapeBeliefsSql } from '@/lib/data/belief-inputs'
import { validAsOfNow } from '@/lib/data/memories'

// Collision engine reads/writes (lane B). Pure DB: candidates for far-apart
// pairs, the stored anchor vector, recently offered pair keys, and the
// linkedAt stamp on an idea's bridge. No embedding calls.

export interface CollisionCandidateRow {
  id: string
  dominionId: string | null
  title: string
  summary: string | null
  createdAt: Date
  embedding: number[]
  linkedIds: string[]
}

export const COLLISION_STREAM_CLASSES = ['reflection', 'idea', 'agentic', 'concept'] as const
export const COLLISION_PER_AREA = 10
export const COLLISION_CANDIDATE_CAP = 80
const EXCLUDED_TYPES = ['inbound', 'idea_candidate']

const live = [isNull(memories.archivedAt), isNull(memories.supersededAt), validAsOfNow] as const
const notAnIdea = sql`jsonb_typeof(coalesce(${memories.sourceMetadata}, '{}'::jsonb)->'idea') IS DISTINCT FROM 'object'`

function toVector(value: unknown): number[] | null {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : null
}

function linkedIdsOf(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  return links.flatMap((l) => {
    const link = l as { target?: unknown; target_kind?: unknown }
    return link && link.target_kind === 'memory' && typeof link.target === 'string' ? [link.target] : []
  })
}

// Live, embedded rows from the owner's own streams (never proposals, prior
// Kairos ideas or external content), ≤10 per area in a date-seeded order.
export async function listCollisionCandidates(userId: string, date: string): Promise<CollisionCandidateRow[]> {
  const shuffle = sql`md5(${memories.id}::text || ${date} || 'collision')`
  const ranked = db
    .select({
      id: memories.id,
      dominionId: memories.dominionId,
      title: memories.title,
      aiTitle: memories.aiTitle,
      summary: memories.summary,
      createdAt: memories.createdAt,
      embedding: memories.embedding,
      links: memories.links,
      rn: sql<number>`row_number() over (partition by ${memories.dominionId} order by ${shuffle})`.as('rn'),
      shuffle: sql<string>`${shuffle}`.as('shuffle'),
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      ...live,
      isNotNull(memories.embedding),
      inArray(memories.streamClass, [...COLLISION_STREAM_CLASSES]),
      notInArray(memories.type, EXCLUDED_TYPES),
      notAnIdea,
      mayShapeBeliefsSql,
    ))
    .as('collision_ranked')

  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rn, COLLISION_PER_AREA))
    .orderBy(ranked.rn, ranked.shuffle)
    .limit(COLLISION_CANDIDATE_CAP)

  return rows.flatMap((r) => {
    const embedding = toVector(r.embedding)
    if (!embedding) return []
    return [{
      id: r.id,
      dominionId: r.dominionId,
      title: r.aiTitle?.trim() || r.title,
      summary: r.summary,
      createdAt: new Date(r.createdAt),
      embedding,
      linkedIds: linkedIdsOf(r.links),
    }]
  })
}

// The latest live Aether row's stored embedding (the anchor), or null.
export async function readLatestAetherEmbedding(userId: string): Promise<number[] | null> {
  const [row] = await db
    .select({ embedding: memories.embedding })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.streamClass, 'aether'), ...live))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? toVector(row.embedding) : null
}

// Pair keys offered in `on` mode by idea_generate jobs of the last `days`.
export async function listRecentCollisionPairKeys(userId: string, now: Date, days: number): Promise<Set<string>> {
  const since = new Date(now.getTime() - days * 86_400_000)
  const rows = await db
    .select({ collision: sql<unknown>`${thinkingJobs.input} #> '{context,collision}'` })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), eq(thinkingJobs.kind, 'idea_generate'), gte(thinkingJobs.createdAt, since)))
  const keys = new Set<string>()
  for (const r of rows) {
    const c = r.collision as { mode?: unknown; pairs?: unknown } | null
    if (!c || c.mode !== 'on' || !Array.isArray(c.pairs)) continue
    for (const p of c.pairs) {
      const key = (p as { pairKey?: unknown })?.pairKey
      if (typeof key === 'string') keys.add(key)
    }
  }
  return keys
}

// True when every id is a live memory of this user.
export async function memoriesLive(userId: string, ids: readonly string[]): Promise<boolean> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return false
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, unique), isNull(memories.archivedAt), isNull(memories.supersededAt)))
  return rows.length === unique.length
}

// Stamps sourceMetadata.idea.bridge.linkedAt on the accepted idea row.
export async function recordBridgeLinked(userId: string, ideaId: string, now: Date = new Date()): Promise<boolean> {
  const updated = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(${memories.sourceMetadata}, '{idea,bridge,linkedAt}', to_jsonb(${now.toISOString()}::text))`,
    })
    .where(and(
      eq(memories.id, ideaId),
      eq(memories.userId, userId),
      sql`jsonb_typeof(${memories.sourceMetadata}->'idea'->'bridge') = 'object'`,
    ))
    .returning({ id: memories.id })
  return updated.length > 0
}
