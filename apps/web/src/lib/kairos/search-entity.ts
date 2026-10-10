// ─────────────────────────────────────────────────────────────────────────
// Total Recall step 2a: the entity list of the retrieval core. Names in the
// query (a repo, a Dominion, a board, a person) are looked up in the owner's
// alias map; memories that mention those entities become a third ranked list
// fused by RRF next to the FTS and vector legs (search-core.ts). The same
// alias rules as the scan apply (capitalised-only stoplist, exact initials).
// Any failure returns no list: the entity leg never fails a read.
// ─────────────────────────────────────────────────────────────────────────

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { aliasRule, isUsableAlias, normAlias, passesRule } from '@/lib/data/entities/normalize'

export const SEARCH_ENTITY_DEFAULT = false

const MAX_GRAM_WORDS = 6
const MAX_GRAMS = 200
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
const POSSESSIVE = /['’]s$/u

export interface QueryGram {
  raw: string
  norm: string
}

// Every 1..6-word window of the query, normalised like an alias.
export function queryGrams(query: string): QueryGram[] {
  const words = query.normalize('NFKC').split(/\s+/).filter(Boolean).map((w) => w.replace(POSSESSIVE, ''))
  const seen = new Set<string>()
  const out: QueryGram[] = []
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_GRAM_WORDS && i + n <= words.length; n++) {
      const raw = words.slice(i, i + n).join(' ').replace(EDGE, '')
      const norm = normAlias(raw)
      const key = `${raw}\u0000${norm}`
      if (!isUsableAlias(norm) || seen.has(key)) continue
      seen.add(key)
      out.push({ raw, norm })
      if (out.length >= MAX_GRAMS) return out
    }
  }
  return out
}

// Alias lookup, merged entities resolved one hop to their survivor.
export async function matchQueryEntities(userId: string, query: string): Promise<string[]> {
  const grams = queryGrams(query)
  if (grams.length === 0) return []
  const norms = sql.join([...new Set(grams.map((g) => g.norm))].map((n) => sql`${n}`), sql`, `)
  const result = await db.execute(sql`
    SELECT coalesce(CASE WHEN e.status = 'merged' THEN e.merged_into_id END, e.id) AS entity_id,
           a.alias, a.alias_norm, e.kind
    FROM entity_aliases a
    JOIN entities e ON e.id = a.entity_id
    WHERE a.user_id = ${userId} AND a.alias_norm IN (${norms})
  `)
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  const ids = new Set<string>()
  for (const r of rows) {
    const alias = String(r.alias ?? '')
    const rule = aliasRule(alias, String(r.kind ?? ''))
    if (grams.some((g) => g.norm === r.alias_norm && passesRule(rule, alias, g.raw))) ids.add(String(r.entity_id))
  }
  return [...ids]
}

export function mentionsAnyEntity(userId: string, entityIds: readonly string[]): SQL {
  const ids = sql.join(entityIds.map((id) => sql`${id}::uuid`), sql`, `)
  return sql`EXISTS (SELECT 1 FROM entity_mentions em WHERE em.memory_id = ${memories.id} AND em.user_id = ${userId} AND em.entity_id IN (${ids}))`
}

export function entityConfidence(userId: string, entityIds: readonly string[]): SQL<number> {
  const ids = sql.join(entityIds.map((id) => sql`${id}::uuid`), sql`, `)
  return sql<number>`(SELECT max(em.confidence) FROM entity_mentions em WHERE em.memory_id = ${memories.id} AND em.user_id = ${userId} AND em.entity_id IN (${ids}))`
}

export interface EntityLegInput<R> {
  userId: string
  query: string
  // Fetch mentioning rows under the caller's full scope, filters and window.
  fetch: (mentions: SQL, confidence: SQL<number>) => Promise<R[]>
}

export async function entityLeg<R>(input: EntityLegInput<R>): Promise<R[]> {
  try {
    const ids = await matchQueryEntities(input.userId, input.query)
    if (ids.length === 0) return []
    return await input.fetch(mentionsAnyEntity(input.userId, ids), entityConfidence(input.userId, ids))
  } catch (err) {
    console.warn('[search-entity] entity list failed, skipped:', err instanceof Error ? err.message : err)
    return []
  }
}
