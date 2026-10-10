import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entities, entityAliases, entityMentions, entityScans, memories } from '@/lib/db/schema'
import { notHeldSensitive } from '@/lib/kairos/sensitive'
import type { GetEntityInput, ListEntitiesInput } from '@/lib/data/validators/entities'
import { normAlias } from './normalize'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const mentionCount = sql<number>`(SELECT count(*)::int FROM ${entityMentions} WHERE ${entityMentions.entityId} = ${entities.id})`
const aliasCount = sql<number>`(SELECT count(*)::int FROM ${entityAliases} WHERE ${entityAliases.entityId} = ${entities.id})`

const ENTITY_COLUMNS = {
  id: entities.id,
  kind: entities.kind,
  name: entities.name,
  source: entities.source,
  status: entities.status,
  refKind: entities.refKind,
  refId: entities.refId,
  mergedIntoId: entities.mergedIntoId,
  mentions: mentionCount,
  aliases: aliasCount,
}

export async function listEntities(userId: string, input: ListEntitiesInput) {
  const q = input.q ? normAlias(input.q).replace(/[\\%_]/g, '\\$&') : ''
  const matchesQuery = q
    ? or(
      ilike(entities.normName, `%${q}%`),
      sql`EXISTS (SELECT 1 FROM ${entityAliases} WHERE ${entityAliases.entityId} = ${entities.id} AND ${entityAliases.aliasNorm} LIKE ${`%${q}%`})`,
    )
    : undefined
  return db
    .select(ENTITY_COLUMNS)
    .from(entities)
    .where(and(
      eq(entities.userId, userId),
      eq(entities.status, 'active'),
      input.kind ? eq(entities.kind, input.kind) : undefined,
      matchesQuery,
    ))
    .orderBy(desc(mentionCount), asc(entities.kind), asc(entities.name))
    .limit(input.limit)
}

async function findEntity(userId: string, idOrName: string) {
  const key = idOrName.trim()
  if (UUID_RE.test(key)) {
    const [row] = await db.select(ENTITY_COLUMNS).from(entities)
      .where(and(eq(entities.userId, userId), eq(entities.id, key.toLowerCase())))
      .limit(1)
    return row ?? null
  }
  const norm = normAlias(key)
  const [row] = await db.select(ENTITY_COLUMNS).from(entities)
    .where(and(
      eq(entities.userId, userId),
      or(
        eq(entities.normName, norm),
        sql`EXISTS (SELECT 1 FROM ${entityAliases} WHERE ${entityAliases.entityId} = ${entities.id} AND ${entityAliases.aliasNorm} = ${norm})`,
      ),
    ))
    .orderBy(sql`CASE WHEN ${entities.normName} = ${norm} THEN 0 ELSE 1 END`, asc(entities.status), desc(mentionCount))
    .limit(1)
  return row ?? null
}

// One entity with its aliases and the live, unheld memories that mention it.
export async function getEntity(userId: string, input: GetEntityInput) {
  const entity = await findEntity(userId, input.id)
  if (!entity) return null
  const [aliasRows, mentionRows] = await Promise.all([
    db.select({ alias: entityAliases.alias, source: entityAliases.source })
      .from(entityAliases)
      .where(eq(entityAliases.entityId, entity.id))
      .orderBy(asc(entityAliases.alias)),
    input.mentions === 0
      ? Promise.resolve([])
      : db.select({
        memoryId: memories.id,
        title: memories.title,
        streamClass: memories.streamClass,
        createdAt: memories.createdAt,
        source: entityMentions.source,
        confidence: entityMentions.confidence,
      })
        .from(entityMentions)
        .innerJoin(memories, eq(memories.id, entityMentions.memoryId))
        .where(and(
          eq(entityMentions.entityId, entity.id),
          eq(memories.userId, userId),
          isNull(memories.archivedAt),
          isNull(memories.supersededAt),
          notHeldSensitive,
        ))
        .orderBy(desc(entityMentions.confidence), desc(memories.createdAt))
        .limit(input.mentions),
  ])
  return { ...entity, aliasList: aliasRows, recentMentions: mentionRows }
}

export interface EntityMapCounts {
  entitiesByKind: Record<string, number>
  aliases: number
  mentionsBySource: Record<string, number>
  memoriesScanned: number
}

export async function entityMapCounts(userId: string): Promise<EntityMapCounts> {
  const [kinds, aliasRows, sources, scans] = await Promise.all([
    db.select({ k: entities.kind, n: sql<number>`count(*)::int` }).from(entities)
      .where(eq(entities.userId, userId)).groupBy(entities.kind),
    db.select({ n: sql<number>`count(*)::int` }).from(entityAliases).where(eq(entityAliases.userId, userId)),
    db.select({ k: entityMentions.source, n: sql<number>`count(*)::int` }).from(entityMentions)
      .where(eq(entityMentions.userId, userId)).groupBy(entityMentions.source),
    db.select({ n: sql<number>`count(*)::int` }).from(entityScans).where(eq(entityScans.userId, userId)),
  ])
  return {
    entitiesByKind: Object.fromEntries(kinds.map((r) => [r.k, Number(r.n)])),
    aliases: Number(aliasRows[0]?.n ?? 0),
    mentionsBySource: Object.fromEntries(sources.map((r) => [r.k, Number(r.n)])),
    memoriesScanned: Number(scans[0]?.n ?? 0),
  }
}

