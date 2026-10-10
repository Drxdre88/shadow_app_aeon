// ─────────────────────────────────────────────────────────────────────────
// Total Recall step 2a: the entity list of the retrieval core. Names in the
// query (a repo, a Dominion, a board, a person) are looked up in the owner's
// alias map; up to ENTITY_LIST_LIMIT memories mentioning those entities,
// ordered by relevance to the query, join the candidates (search-core.ts).
// The same alias rules as the scan apply (capitalised-only stoplist, exact
// initials). Tuned 10/10 after the eval regression: only a strong match fires
// (a capitalised word, a multi-word or slug alias, exact initials), a very
// common entity needs a multi-word or slug alias, and the list never re-orders
// rows the legs found: it only adds rows (rerank input in hybrid mode,
// trailing the FTS rows in FTS-only mode).
// Any failure returns no list: the entity leg never fails a read.
// ─────────────────────────────────────────────────────────────────────────

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { aliasRule, isUsableAlias, normAlias, passesRule } from '@/lib/data/entities/normalize'

export const SEARCH_ENTITY_DEFAULT = false
export const ENTITY_LIST_LIMIT = 8
// FTS-only mode: the first entity-only row trails the weakest FTS row at this
// fraction of its rank, decaying by list position.
export const ENTITY_TRAIL_WEIGHT = 0.4
// Above this many mentions a single-word name says little about relevance.
export const COMMON_ENTITY_MENTIONS = 300

export function entityTrailRelevance(weakestFtsRank: number, position: number): number {
  return ((weakestFtsRank > 0 ? weakestFtsRank : 1) * ENTITY_TRAIL_WEIGHT) / (1 + position)
}

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

export interface EntityMatch {
  id: string
  // Named by a capitalised word, exact initials or a multi-word / slug alias.
  strong: boolean
  // Named by a multi-word or slug alias (`AS Sprint`, `shadow_app_aeon`).
  specific: boolean
  mentions: number
}

const SPECIFIC_ALIAS = /[\s_\-/]/u

function startsCapitalised(raw: string): boolean {
  const first = raw.charAt(0)
  return first !== first.toLowerCase() && first === first.toUpperCase()
}

// Alias lookup, merged entities resolved one hop to their survivor; each match
// carries how strongly the query named it and how often the entity is mentioned.
export async function matchQueryEntities(userId: string, query: string): Promise<EntityMatch[]> {
  const grams = queryGrams(query)
  if (grams.length === 0) return []
  const norms = sql.join([...new Set(grams.map((g) => g.norm))].map((n) => sql`${n}`), sql`, `)
  const result = await db.execute(sql`
    SELECT x.entity_id, x.alias, x.alias_norm, x.kind,
           (SELECT count(*) FROM entity_mentions m WHERE m.user_id = ${userId} AND m.entity_id = x.entity_id)::int AS mentions
    FROM (
      SELECT coalesce(CASE WHEN e.status = 'merged' THEN e.merged_into_id END, e.id) AS entity_id,
             a.alias, a.alias_norm, e.kind
      FROM entity_aliases a
      JOIN entities e ON e.id = a.entity_id
      WHERE a.user_id = ${userId} AND a.alias_norm IN (${norms})
    ) x
  `)
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  const byId = new Map<string, EntityMatch>()
  for (const r of rows) {
    const alias = String(r.alias ?? '')
    const aliasNorm = String(r.alias_norm ?? '')
    const rule = aliasRule(alias, String(r.kind ?? ''))
    const hits = grams.filter((g) => g.norm === aliasNorm && passesRule(rule, alias, g.raw))
    if (hits.length === 0) continue
    const id = String(r.entity_id)
    const specific = SPECIFIC_ALIAS.test(aliasNorm)
    const strong = specific || rule === 'exact' || hits.some((g) => startsCapitalised(g.raw))
    const prev = byId.get(id)
    byId.set(id, {
      id,
      strong: strong || (prev?.strong ?? false),
      specific: specific || (prev?.specific ?? false),
      mentions: Number(r.mentions ?? 0) || 0,
    })
  }
  return [...byId.values()]
}

// Entities worth a list: strongly named, and a very common one only by a
// multi-word or slug alias (a bare `Swarm` or `Aeon` tags too much to rank).
export function listWorthyEntities(matches: readonly EntityMatch[]): string[] {
  return matches
    .filter((m) => m.strong && (m.specific || m.mentions <= COMMON_ENTITY_MENTIONS))
    .map((m) => m.id)
}

export function mentionsAnyEntity(userId: string, entityIds: readonly string[]): SQL {
  const ids = sql.join(entityIds.map((id) => sql`${id}::uuid`), sql`, `)
  return sql`EXISTS (SELECT 1 FROM entity_mentions em WHERE em.memory_id = ${memories.id} AND em.user_id = ${userId} AND em.entity_id IN (${ids}))`
}

export interface EntityLegInput<R> {
  userId: string
  query: string
  // Fetch at most `limit` mentioning rows, ordered by relevance to the query,
  // under the caller's full scope, filters and window.
  fetch: (mentions: SQL, limit: number) => Promise<R[]>
}

export async function entityLeg<R>(input: EntityLegInput<R>): Promise<R[]> {
  try {
    const ids = listWorthyEntities(await matchQueryEntities(input.userId, input.query))
    if (ids.length === 0) return []
    return await input.fetch(mentionsAnyEntity(input.userId, ids), ENTITY_LIST_LIMIT)
  } catch (err) {
    console.warn('[search-entity] entity list failed, skipped:', err instanceof Error ? err.message : err)
    return []
  }
}
