import { and, asc, eq, gt, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entities, entityAliases, entityMentions, entityScans, memories } from '@/lib/db/schema'
import { notHeldSensitive } from '@/lib/kairos/sensitive'
import { MACHINE_STREAMS } from '@/lib/kairos/search-streams'
import { EntityMatcher, memoryScanText, type MatcherAlias } from './matcher'
import { lastRepoSegment, normAlias, repoKey, repoSlugForm } from './normalize'

export const SCAN_BATCH = 200
export const FK_CONFIDENCE = 1
export const DICT_CONFIDENCE = 0.7

export interface ScanCounts {
  scanned: number
  cleared: number
  fk: number
  dict: number
}

interface ScanRow {
  id: string
  title: string
  summary: string | null
  bodyMd: string | null
  dominionId: string | null
  projectId: string | null
  sourceMetadata: unknown
}

const SCAN_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  bodyMd: memories.bodyMd,
  dominionId: memories.dominionId,
  projectId: memories.projectId,
  sourceMetadata: memories.sourceMetadata,
}

// Machine, archived, superseded and held rows carry no fk/dict mentions.
export function scanEligible(): SQL[] {
  return [
    isNull(memories.archivedAt),
    isNull(memories.supersededAt),
    notInArray(memories.streamClass, [...MACHINE_STREAMS]),
    notHeldSensitive,
  ]
}

const notEligible = () => sql`NOT (${sql.join(scanEligible(), sql` AND `)})`

function repoOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  return lastRepoSegment((meta as Record<string, unknown>).repo)
}

export class EntityScanner {
  private constructor(
    private readonly userId: string,
    private readonly matcher: EntityMatcher,
    private readonly byRef: ReadonlyMap<string, string>,
    private readonly repoByAlias: ReadonlyMap<string, string>,
  ) {}

  static async load(userId: string): Promise<EntityScanner> {
    const target = sql<string>`coalesce(CASE WHEN ${entities.status} = 'merged' THEN ${entities.mergedIntoId} END, ${entities.id})`
    const [aliasRows, refRows] = await Promise.all([
      db.select({ entityId: target, alias: entityAliases.alias, aliasNorm: entityAliases.aliasNorm, kind: entities.kind })
        .from(entityAliases)
        .innerJoin(entities, eq(entities.id, entityAliases.entityId))
        .where(eq(entityAliases.userId, userId)),
      db.select({ entityId: target, refKind: entities.refKind, refId: entities.refId })
        .from(entities)
        .where(and(eq(entities.userId, userId), inArray(entities.refKind, ['dominion', 'project']))),
    ])
    const byRef = new Map(refRows.map((r) => [`${r.refKind}:${r.refId}`, r.entityId]))
    const repoByAlias = new Map(aliasRows.filter((a) => a.kind === 'repo').map((a) => [a.aliasNorm, a.entityId]))
    const matcherAliases: MatcherAlias[] = aliasRows.map((a) => ({ entityId: a.entityId, alias: a.alias, kind: a.kind }))
    return new EntityScanner(userId, new EntityMatcher(matcherAliases), byRef, repoByAlias)
  }

  // A junk repo value (dev_26, a host name) resolves to nothing; never creates.
  repoEntity(meta: unknown): string | null {
    const seg = repoOf(meta)
    if (!seg) return null
    for (const k of [normAlias(seg), repoSlugForm(seg), repoKey(seg)]) {
      const hit = this.repoByAlias.get(k)
      if (hit) return hit
    }
    return null
  }

  fkEntities(row: ScanRow): Set<string> {
    const out = new Set<string>()
    const add = (id: string | null | undefined) => { if (id) out.add(id) }
    if (row.dominionId) add(this.byRef.get(`dominion:${row.dominionId}`))
    if (row.projectId) add(this.byRef.get(`project:${row.projectId}`))
    add(this.repoEntity(row.sourceMetadata))
    return out
  }

  async writeBatch(rows: ScanRow[]): Promise<Omit<ScanCounts, 'cleared'>> {
    if (rows.length === 0) return { scanned: 0, fk: 0, dict: 0 }
    const ids = rows.map((r) => r.id)
    const fk: Array<typeof entityMentions.$inferInsert> = []
    const dict: Array<typeof entityMentions.$inferInsert> = []
    for (const row of rows) {
      const fkIds = this.fkEntities(row)
      for (const entityId of fkIds) fk.push({ entityId, memoryId: row.id, userId: this.userId, source: 'fk', confidence: FK_CONFIDENCE })
      for (const entityId of this.matcher.match(memoryScanText(row))) {
        if (!fkIds.has(entityId)) dict.push({ entityId, memoryId: row.id, userId: this.userId, source: 'dict', confidence: DICT_CONFIDENCE })
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(entityMentions).where(and(
        eq(entityMentions.userId, this.userId),
        inArray(entityMentions.memoryId, ids),
        inArray(entityMentions.source, ['fk', 'dict']),
      ))
      if (fk.length > 0) await tx.insert(entityMentions).values(fk).onConflictDoNothing()
      if (dict.length > 0) await tx.insert(entityMentions).values(dict).onConflictDoNothing()
      await tx
        .insert(entityScans)
        .values(ids.map((memoryId) => ({ memoryId, userId: this.userId, method: 'dict' })))
        .onConflictDoUpdate({ target: entityScans.memoryId, set: { scannedAt: sql`now()`, method: 'dict', model: null } })
    })
    return { scanned: rows.length, fk: fk.length, dict: dict.length }
  }
}

async function clearIneligible(userId: string, memoryIds?: string[]): Promise<number> {
  const scope = memoryIds ? sql`AND ${inArray(memories.id, memoryIds)}` : sql``
  const cleared = await db
    .delete(entityMentions)
    .where(and(
      eq(entityMentions.userId, userId),
      inArray(entityMentions.source, ['fk', 'dict']),
      sql`${entityMentions.memoryId} IN (SELECT ${memories.id} FROM ${memories} WHERE ${memories.userId} = ${userId} ${scope} AND ${notEligible()})`,
    ))
    .returning({ memoryId: entityMentions.memoryId })
  return cleared.length
}

// Rescan the given memories (on write) or every memory of the user (backfill).
export async function rescanMemories(userId: string, memoryIds?: string[]): Promise<ScanCounts> {
  const totals: ScanCounts = { scanned: 0, cleared: await clearIneligible(userId, memoryIds), fk: 0, dict: 0 }
  const scanner = await EntityScanner.load(userId)
  let after: string | null = null
  for (;;) {
    const page: ScanRow[] = await db
      .select(SCAN_COLUMNS)
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        ...scanEligible(),
        ...(memoryIds ? [inArray(memories.id, memoryIds)] : []),
        ...(after ? [gt(memories.id, after)] : []),
      ))
      .orderBy(asc(memories.id))
      .limit(SCAN_BATCH)
    if (page.length === 0) break
    const done = await scanner.writeBatch(page)
    totals.scanned += done.scanned
    totals.fk += done.fk
    totals.dict += done.dict
    after = page[page.length - 1].id
    if (page.length < SCAN_BATCH) break
  }
  return totals
}
