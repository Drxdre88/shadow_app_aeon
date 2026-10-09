import { eq } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import type { PrepareContextInput } from './validators'
import { listMemories, getNeighbours, findMemoriesByIds } from './memories'
import { exactFilterConditions } from './memories-search'
import { loadTodayContextSection } from './prepare-context-today'
import { rankScore } from '@/lib/kairos/ranking'
import { REAL_MEMORY_STREAMS, searchCore } from '@/lib/kairos/search-core'
import { SEARCH_EXPAND_DEFAULT, type SearchVia } from '@/lib/kairos/search-expand'
import { assessConfidence } from '@/lib/kairos/retrieval-confidence'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 — prepare_context (moved out of memories.ts; re-exported
// there). Hits come from the shared retrieval core (lib/kairos/search-core):
// hybrid FTS+vector RRF, standing ranking, rerank, real-memory streams by
// default, optional Dominion scope. Then pinned rows + a 1-hop graph walk are
// merged, scored relevance × standing and packed into a token budget.
// Token estimation: ~4 chars/token, good enough for guard rails.
// ─────────────────────────────────────────────────────────────────────────

const EDGE_BONUS: Record<string, number> = {
  supports:        0.5,
  contradicts:     0.4,
  supersedes:      0.3,
  refers_to:       0.3,
  relates:         0.2,
  blocks_thinking: 0.1,
}

// Agent pools are wider than chat's (maxSources ≤ 100); cap what the
// cross-encoder reads per call so latency/cost stay bounded.
const CONTEXT_RERANK_POOL_MAX = 40
const CONTEXT_RERANK_CHARS = 4000

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

type Candidate = {
  id: string
  title: string
  summary: string | null
  type: string
  source: string
  createdAt: Date
  updatedAt?: Date | null   // reinforcement signal for confidence decay
  confidence?: number | null // stored trust prior; absent → neutral (no effect)
  standing?: number | null   // memory-engine standing; absent → P0 fallback
  pinned: boolean
  baseScore: number
  origin: 'pinned' | 'hit' | 'neighbour'
  snippet?: string  // populated for FTS hits
  edgeType?: string // populated for neighbours
  via?: SearchVia   // hits: core provenance; neighbours: 'link'; pinned: none
}

type Scored = Candidate & { compositeScore: number }

export type ContextSource = {
  id: string; title: string; score: number; section: 'pinned' | 'relevant' | 'related'; via?: SearchVia
}

export async function prepareContext(userId: string, input: PrepareContextInput) {
  const budget = input.budgetTokens
  const realmId = input.realmId
  // Today across channels (≤15% of budget) — read in parallel with retrieval.
  const todayPromise = input.includeToday === false ? Promise.resolve('') : loadTodayContextSection(userId, budget)

  // ── 1. Shared retrieval core. An explicit `type` filter is an exact ask,
  //      so it lifts the real-memory stream default like includeMachine. ──
  const core = await searchCore(userId, {
    query: input.query,
    limit: input.maxSources,
    dominionId: input.dominionId ?? null,
    streams: input.includeMachine || input.type ? null : REAL_MEMORY_STREAMS,
    filters: [
      ...(realmId ? [eq(memories.realmId, realmId)] : []),
      ...exactFilterConditions({ type: input.type }),
    ],
    rerankPoolMax: CONTEXT_RERANK_POOL_MAX,
    rerankChars: CONTEXT_RERANK_CHARS,
    snippets: true,
    minQueryChars: 2,
    expand: input.expand ?? SEARCH_EXPAND_DEFAULT,
  })
  // relevance (pre-standing) is the base score: the composite below applies
  // the standing factor exactly once.
  const hits = core.hits.map((h) => ({ ...h.row, rank: h.relevance, snippet: h.row.snippet ?? '', via: h.via }))

  // ── 2. Pinned fetch (user-scoped, realm-scoped if provided) ──────────
  const pinned = input.includePinned
    ? await listMemories(userId, { pinnedOnly: true, liveOnly: true, realmId, limit: 20 })
    : []

  // ── 3. 1-hop graph walk in parallel from top-10 hits ─────────────────
  const seeds = hits.slice(0, 10)
  const parentRanks = new Map(seeds.map((h) => [h.id, h.rank]))
  let neighbours: Array<{ id: string; title: string; summary: string | null; type: string; source: string; createdAt: Date; edgeType: string; parentId: string }> = []
  if (input.hops >= 1 && seeds.length > 0) {
    const walks = await Promise.all(
      seeds.map(async ({ id: sid }) => {
        const rows = await getNeighbours(sid, userId, { hops: 1, includeReverse: true, limit: 5, liveOnly: true })
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          type: r.type,
          source: r.source,
          createdAt: r.createdAt,
          edgeType: r.edgeType,
          parentId: sid,
        }))
      })
    )
    neighbours = walks.flat()
  }

  // ── 4. Build candidate set with composite scoring. Query hits claim their
  //      ids first, so a pinned memory that also matches is cited once, as a
  //      relevant hit; the rest of the pinned set follows. ──
  const seen = new Set<string>()
  const candidates: Candidate[] = []

  for (const h of hits) {
    if (seen.has(h.id)) continue
    seen.add(h.id)
    candidates.push({
      id: h.id, title: h.title, summary: h.summary ?? null, type: h.type ?? 'note', source: h.source ?? 'manual',
      createdAt: h.createdAt, updatedAt: h.updatedAt, confidence: h.confidence, standing: h.standing,
      pinned: !!h.pinned, baseScore: h.rank, origin: 'hit', snippet: h.snippet, via: h.via,
    })
  }
  for (const p of pinned) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    candidates.push({
      id: p.id, title: p.title, summary: p.summary, type: p.type, source: p.source,
      createdAt: p.createdAt, updatedAt: p.updatedAt, confidence: p.confidence, standing: p.standing,
      pinned: true, baseScore: 2.0, origin: 'pinned',
    })
  }
  for (const n of neighbours) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    const parentRank = parentRanks.get(n.parentId) ?? 0
    const bonus = EDGE_BONUS[n.edgeType] ?? 0.1
    candidates.push({
      id: n.id, title: n.title, summary: n.summary, type: n.type, source: n.source, createdAt: n.createdAt,
      pinned: false, baseScore: parentRank * 0.5 + bonus, origin: 'neighbour', edgeType: n.edgeType, via: 'link',
    })
  }

  // Shared ranker: standing once scored; otherwise P0 confidence decay ×
  // recency (neutral for pinned, neighbours, and rows without a prior).
  const rankNow = Date.now()
  const scored: Scored[] = candidates
    .map((c) => ({ ...c, compositeScore: rankScore(c.baseScore, c, rankNow) }))
    .sort((a, b) => b.compositeScore - a.compositeScore)

  // ── 5. Full bodies for the top 40 (beyond that: Related, summary only) ──
  const bodies = await findMemoriesByIds(scored.slice(0, 40).map((c) => c.id), userId)
  const bodyById = new Map(bodies.map((b) => [b.id, b]))

  const todaySection = await todayPromise
  const packed = packSections(scored, bodyById, budget, todaySection)
  const confidence = assessConfidence(core.topRelevance)
  const contextMd = renderContext(input.query, budget, todaySection, packed, candidates.length === 0, confidence.lowConfidence)

  return {
    contextMd,
    tokensUsed: estimateTokens(contextMd),
    sources: packed.sources,
    // Additive (Wave 1): which retrieval path produced the hits, and how
    // confident the best match is (flag only; pinned/today never dropped).
    retrieval: { mode: core.mode, reranked: core.reranked, ...confidence },
  }
}

type Packed = {
  pinnedItems: Array<Scored & { body: string }>
  relevantItems: Array<Scored & { body: string }>
  relatedItems: Scored[]
  sources: ContextSource[]
}

// ── 6. Pack into Most relevant → Pinned → Related sections. Pinned rows
//      that overflow their budget drop to Related; they never take a
//      Most-relevant slot from a query match. ──
function packSections(
  scored: Scored[],
  bodyById: Map<string, { bodyMd: string | null }>,
  budget: number,
  todaySection: string,
): Packed {
  const headerOverhead = 200 + estimateTokens(todaySection)  // header + section titles + sources block + Today
  const pinnedBudget   = Math.floor((budget - headerOverhead) * 0.30)
  const relevantBudget = Math.floor((budget - headerOverhead) * 0.55)
  const relatedBudget  = Math.max(budget - headerOverhead - pinnedBudget - relevantBudget, 200)

  const out: Packed = { pinnedItems: [], relevantItems: [], relatedItems: [], sources: [] }
  let pinnedUsed = 0
  let relevantUsed = 0
  let relatedUsed = 0

  for (const c of scored) {
    const body = bodyById.get(c.id)?.bodyMd ?? c.summary ?? ''
    const bodyTokens = estimateTokens(body) + estimateTokens(c.title) + 30  // body + title + section overhead

    if (c.origin === 'pinned') {
      if (pinnedUsed + bodyTokens <= pinnedBudget) {
        out.pinnedItems.push({ ...c, body })
        pinnedUsed += bodyTokens
        continue
      }
    } else if (relevantUsed + bodyTokens <= relevantBudget && out.relevantItems.length < 8) {
      out.relevantItems.push({ ...c, body })
      relevantUsed += bodyTokens
      continue
    } else if (c.pinned && pinnedUsed + bodyTokens <= pinnedBudget) {
      // A pinned memory that matched only weakly keeps its full body in Pinned.
      out.pinnedItems.push({ ...c, body })
      pinnedUsed += bodyTokens
      continue
    }
    const summaryTokens = estimateTokens(c.summary ?? c.title) + 20
    if (relatedUsed + summaryTokens <= relatedBudget) {
      out.relatedItems.push(c)
      relatedUsed += summaryTokens
    }
    // Else: drop. Sources block at end will still cite it.
  }

  const score = (c: Scored) => Number(c.compositeScore.toFixed(3))
  const via = (c: Scored) => (c.via ? { via: c.via } : {})
  for (const r of out.relevantItems) out.sources.push({ id: r.id, title: r.title, score: score(r), section: 'relevant', ...via(r) })
  for (const p of out.pinnedItems) out.sources.push({ id: p.id, title: p.title, score: score(p), section: 'pinned', ...via(p) })
  for (const r of out.relatedItems) out.sources.push({ id: r.id, title: r.title, score: score(r), section: 'related', ...via(r) })
  return out
}

// ── 7. Render markdown ──────────────────────────────────────────────────
function renderContext(
  query: string, budget: number, todaySection: string, packed: Packed, empty: boolean, lowConfidence: boolean,
): string {
  const { pinnedItems, relevantItems, relatedItems, sources } = packed
  const lines: string[] = []
  lines.push(`# Context for: ${query}`)
  lines.push('')
  lines.push(`> Budget: ${budget} tokens · Relevant: ${relevantItems.length} · Pinned: ${pinnedItems.length} · Related: ${relatedItems.length}`)
  lines.push('')

  if (todaySection) {
    lines.push(todaySection)
    lines.push('')
  }

  if (lowConfidence && !empty) {
    lines.push('> Low confidence: no memory closely matches this query; treat the matches below as weak leads.')
    lines.push('')
  }

  if (relevantItems.length > 0) {
    lines.push('## Most relevant')
    lines.push('')
    for (const r of relevantItems) {
      const date = new Date(r.createdAt).toISOString().slice(0, 10)
      const linked = r.origin === 'neighbour' && r.edgeType ? ` · linked: ${r.edgeType}` : ''
      lines.push(`### ${r.title}`, `*${date} · ${r.type} · ${r.source}${linked}*`, '', r.body, '', '---', '')
    }
  }

  if (pinnedItems.length > 0) {
    lines.push('## Pinned')
    lines.push('')
    for (const p of pinnedItems) {
      const date = new Date(p.createdAt).toISOString().slice(0, 10)
      lines.push(`### ${p.title}`, `*${date} · ${p.type} · ${p.source}*`, '', p.body, '', '---', '')
    }
  }

  if (relatedItems.length > 0) {
    lines.push('## Related')
    lines.push('')
    for (const r of relatedItems) {
      const date = new Date(r.createdAt).toISOString().slice(0, 10)
      const summary = r.summary ?? r.title
      const linked = r.origin === 'neighbour' && r.edgeType ? ` *(${r.edgeType})*` : ''
      lines.push(`- **${r.title}** · ${date}${linked} — ${summary}`)
    }
    lines.push('')
  }

  if (empty) {
    lines.push('_No matching memories found for this query._')
    lines.push('')
  }

  lines.push('## Sources')
  for (const s of sources) lines.push(`- \`${s.id}\` · ${s.title} · score ${s.score} · ${s.section}`)
  return lines.join('\n')
}
