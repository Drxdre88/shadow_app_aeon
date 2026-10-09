// ─────────────────────────────────────────────────────────────────────────
// Graph step 1, Option A (decision memory 03562938): widen the rerank pool of
// the shared retrieval core (search-core.ts) before the cross-encoder judges
// it, with two kinds of extra candidates:
//
//   link      one-hop neighbours (both directions) of the top fused seeds over
//             refers_to / supports / contradicts edges (one set-based query);
//   signpost  real memories cited by the live archetypes nearest the query
//             (the archetype rows themselves never become results).
//
// Every extra passes the caller's full scope through `hydrate` (user,
// Dominion, streams, liveness, filters, window), is deduped against the pool
// and capped at EXPAND_CAP, split fairly between the kinds. Any failure
// returns no extras: expansion never fails a read. Default OFF until the eval
// passes; flipping SEARCH_EXPAND_DEFAULT turns it on for every surface.
// ─────────────────────────────────────────────────────────────────────────

import { and, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'

export const SEARCH_EXPAND_DEFAULT = false

export const EXPAND_SEEDS = 8
export const EXPAND_CAP = 12
export const SIGNPOST_TOP_K = 3
// supersedes targets are dead rows; relates / blocks_thinking are too loose.
export const LINK_EXPAND_TYPES = ['refers_to', 'supports', 'contradicts'] as const
const LINK_ROW_LIMIT = 48

export type SearchVia = 'search' | 'link' | 'signpost'
export type ExpandVia = Exclude<SearchVia, 'search'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null
}

// Archetype sourceMetadata.citedMemoryIds; tolerates a missing or malformed field.
export function citedIdsOf(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object') return []
  const cited = (meta as Record<string, unknown>).citedMemoryIds
  if (!Array.isArray(cited)) return []
  return cited.map(asUuid).filter((id): id is string => id !== null)
}

// One-hop neighbours of every seed in one query, outgoing and incoming,
// ordered by the best (lowest) seed rank that reached them.
export async function linkNeighbourIds(userId: string, seedIds: readonly string[]): Promise<string[]> {
  const seeds = seedIds.map(asUuid).filter((id): id is string => id !== null)
  if (seeds.length === 0) return []
  const values = sql.join(seeds.map((id, i) => sql`(${id}::uuid, ${i}::int)`), sql`, `)
  const types = sql.join(LINK_EXPAND_TYPES.map((t) => sql`${t}`), sql`, `)
  const links = sql.raw(`jsonb_array_elements(CASE WHEN jsonb_typeof(m.links) = 'array' THEN m.links ELSE '[]'::jsonb END)`)
  const result = await db.execute(sql`
    WITH seeds(id, ord) AS (VALUES ${values}),
    edges AS (
      SELECT lower(l->>'target') AS id, s.ord
      FROM seeds s
      JOIN memories m ON m.id = s.id AND m.user_id = ${userId}
      CROSS JOIN LATERAL ${links} AS l
      WHERE l->>'target_kind' = 'memory' AND l->>'type' IN (${types})
      UNION ALL
      SELECT m.id::text AS id, s.ord
      FROM memories m
      CROSS JOIN LATERAL ${links} AS l
      JOIN seeds s ON s.id::text = lower(l->>'target')
      WHERE m.user_id = ${userId}
        AND l->>'target_kind' = 'memory' AND l->>'type' IN (${types})
    )
    SELECT id, min(ord) AS ord FROM edges GROUP BY id ORDER BY min(ord), id
    LIMIT ${LINK_ROW_LIMIT}
  `)
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  return rows.map((r) => asUuid(r.id)).filter((id): id is string => id !== null)
}

// Memories cited by the archetypes nearest the query vector. `archetypeScope`
// carries user, Dominion, streamClass='archetype' and liveness from the core.
// The `+ 0` forces an exact distance over the few archetype rows instead of an
// HNSW walk that a rare stream filter would starve.
export async function signpostCitedIds(archetypeScope: SQL[], vectorLiteral: string): Promise<string[]> {
  const rows = await db
    .select({ meta: memories.sourceMetadata })
    .from(memories)
    .where(and(...archetypeScope, sql`${memories.embedding} IS NOT NULL`))
    .orderBy(sql`(${memories.embedding} <=> ${vectorLiteral}::vector) + 0`)
    .limit(SIGNPOST_TOP_K)
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) for (const id of citedIdsOf(r.meta)) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Fair split of `cap`: each kind gets half, unused slots go to the other kind.
// Links keep seed-rank order and come first; an id found both ways is a link.
export function capFairly(links: readonly string[], signposts: readonly string[], cap: number = EXPAND_CAP) {
  const linkSet = new Set(links)
  const signs = signposts.filter((id) => !linkSet.has(id))
  const half = Math.floor(cap / 2)
  const nLinks = Math.min(links.length, Math.max(half, cap - Math.min(signs.length, cap - half)))
  const nSigns = Math.min(signs.length, cap - nLinks)
  return [
    ...links.slice(0, nLinks).map((id) => ({ id, via: 'link' as const })),
    ...signs.slice(0, nSigns).map((id) => ({ id, via: 'signpost' as const })),
  ]
}

export interface ExpandInput<R extends { id: string }> {
  userId: string
  // Top fused rows in rank order (seeds for the link walk).
  seedIds: readonly string[]
  // Ids already in the rerank pool; never re-added.
  pooled: ReadonlySet<string>
  // Rows the main legs already found (and scoped); reused without a query.
  known: ReadonlyMap<string, R>
  archetypeScope: SQL[]
  vectorLiteral: string
  // Fetch rows by id under the caller's full scope + filters + window.
  hydrate: (ids: string[]) => Promise<R[]>
}

export interface Expansion<R> {
  row: R
  via: ExpandVia
}

export async function expandCandidates<R extends { id: string }>(input: ExpandInput<R>): Promise<Expansion<R>[]> {
  try {
    const [links, signposts] = await Promise.all([
      linkNeighbourIds(input.userId, input.seedIds.slice(0, EXPAND_SEEDS)),
      signpostCitedIds(input.archetypeScope, input.vectorLiteral),
    ])
    const fresh = (ids: string[]) => ids.filter((id) => !input.pooled.has(id))
    const linkIds = fresh(links)
    const signIds = fresh(signposts)
    const unknown = [...new Set([...linkIds, ...signIds])].filter((id) => !input.known.has(id))
    const hydrated = unknown.length > 0 ? await input.hydrate(unknown) : []
    const rows = new Map<string, R>(input.known)
    for (const r of hydrated) rows.set(r.id, r)
    // Only ids that passed the scope count toward the cap.
    const passes = (id: string) => rows.has(id)
    return capFairly(linkIds.filter(passes), signIds.filter(passes)).map(({ id, via }) => ({ row: rows.get(id)!, via }))
  } catch (err) {
    console.warn('[search-expand] expansion failed, unexpanded pool:', err instanceof Error ? err.message : err)
    return []
  }
}
