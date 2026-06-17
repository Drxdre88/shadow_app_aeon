import { db } from '@/lib/db'
import { memories, dominions, dominionRepos, projects } from '@/lib/db/schema'
import { eq, and, desc, sql, inArray, isNull } from 'drizzle-orm'
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchMemoriesInput,
  AddLinkInput,
  MemoryLink,
  PrepareContextInput,
  AcceptProposalInput,
} from './validators'
import type { StreamClass } from '@/lib/kairos/streamClass'
import { resolveDominionForMemory } from './dominions'
import {
  embedTexts,
  embedOne,
  toVectorLiteral,
  embeddingsEnabled,
  activeEmbeddingModel,
} from '@/lib/kairos/embeddings'
import {
  buildClusters,
  pickCanonical,
  AUTO_DEDUP_TYPES,
  DEFAULT_DEDUP_THRESHOLD,
  type DedupCandidate,
} from '@/lib/kairos/dedup'

// Internal extension: the public zod schema (createMemorySchema) intentionally
// does NOT expose streamClass — public callers (MCP/REST) must not pick a
// stream class. The dispatcher (lib/kairos/dispatch.ts) needs to write
// 'advisory' primaries and 'trace' bookkeeping rows, so the function signature
// is widened with this internal-only field. captureMemory forwards it through.
type CreateMemoryParams = CreateMemoryInput & { streamClass?: StreamClass }

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 1 — pure DB queries for the user-scoped memory substrate.
// Auth (user identity) is established at the action / route layer. Every
// function below takes `userId` as a required filter; we do not return rows
// the user does not own.
//
// The `fts` tsvector column is a Postgres-side STORED generated column not
// modelled in the Drizzle schema. We reference it via raw SQL identifiers.
// Spec: docs/brain/02-mcp-tools.md
// ─────────────────────────────────────────────────────────────────────────

// Provenance: a coarse trust prior derived from the stream a memory came from.
// Operator reflections are near-ground-truth; agent/execution output is lower.
// Stamped at write time; weights retrieval/synthesis and gates whether a
// proposal can ever auto-promote (autonomy L2+). Tunable, not load-bearing yet.
const CONFIDENCE_BY_STREAM: Record<string, number> = {
  reflection: 0.9,
  cortex: 0.7,
  idea: 0.6,
  archetype: 0.6,
  advisory: 0.5,
  agentic: 0.45,
  execution: 0.35,
  trace: 0.3,
}

function confidenceForStreamClass(streamClass: string): number {
  return CONFIDENCE_BY_STREAM[streamClass] ?? 0.5
}

// When an introspection proposal is accepted, what does it become? Endorsing a
// proposal makes it operator-weighted (streamClass 'reflection'); a 'question'
// stays a lighter note. Override-able via acceptProposal({ asType }).
function committedTypeForKind(kind: string): string {
  switch (kind) {
    case 'reflection': return 'reflection'
    case 'question':   return 'note'
    default:           return 'observation' // tension / connection / unknown
  }
}

const SLIM_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  type: memories.type,
  source: memories.source,
  sourceMetadata: memories.sourceMetadata,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
  realmId: memories.realmId,
  projectId: memories.projectId,
  taskId: memories.taskId,
  tags: memories.tags,
  pinned: memories.pinned,
} as const

export async function findMemoryById(memoryId: string, userId: string) {
  const [row] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .limit(1)
  return row ?? null
}

type ListOpts = {
  limit?: number
  offset?: number
  type?: string | string[]
  realmId?: string
  projectId?: string
  taskId?: string
  pinnedOnly?: boolean
  includeArchived?: boolean
}

export async function listMemories(userId: string, opts: ListOpts = {}) {
  const conditions = [eq(memories.userId, userId)]
  if (!opts.includeArchived) {
    conditions.push(sql`${memories.archivedAt} IS NULL`)
  }
  if (opts.type) {
    const types = Array.isArray(opts.type) ? opts.type : [opts.type]
    conditions.push(sql`${memories.type} = ANY(${types})`)
  }
  if (opts.realmId)   conditions.push(eq(memories.realmId, opts.realmId))
  if (opts.projectId) conditions.push(eq(memories.projectId, opts.projectId))
  if (opts.taskId)    conditions.push(eq(memories.taskId, opts.taskId))
  if (opts.pinnedOnly) conditions.push(eq(memories.pinned, true))

  return db
    .select(SLIM_COLUMNS)
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.pinned), desc(memories.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
}

// Types worth an LLM summary backfill — human / narrative memories only.
// Machine types (snapshot, achievement, session_event, advisory, external_event,
// inbound, fact, contact) and synthesis types (archetype, dominion_cortex, aether)
// carry their own structure and must NOT flood the summary backlog — otherwise the
// nightly hygiene loop refills with noise and never empties.
// Allowlist, not blocklist: a machine type added later is excluded by default
// instead of silently leaking in.
export const SUMMARY_WORTHY_TYPES = [
  'note', 'decision', 'idea', 'observation', 'session_summary', 'reflection',
] as const

// The set of types the backlog query should scope to: an explicit caller filter
// when given, otherwise the summary-worthy allowlist. Pure so it can be unit-tested
// without a DB.
export function summaryBacklogTypes(optType?: string | string[]): string[] {
  if (optType) return Array.isArray(optType) ? optType : [optType]
  return [...SUMMARY_WORTHY_TYPES]
}

type NeedsSummaryOpts = {
  limit?: number
  offset?: number
  realmId?: string
  projectId?: string
  type?: string | string[]
  missing?: 'execSummary' | 'aiTitle' | 'either'
  oldestFirst?: boolean
}

export async function listMemoriesNeedingSummary(userId: string, opts: NeedsSummaryOpts = {}) {
  const conditions = [
    eq(memories.userId, userId),
    sql`${memories.archivedAt} IS NULL`,
  ]
  const missing = opts.missing ?? 'execSummary'
  if (missing === 'execSummary') {
    conditions.push(sql`jsonb_array_length(${memories.execSummary}) = 0`)
  } else if (missing === 'aiTitle') {
    conditions.push(sql`${memories.aiTitle} IS NULL`)
  } else {
    conditions.push(sql`(jsonb_array_length(${memories.execSummary}) = 0 OR ${memories.aiTitle} IS NULL)`)
  }
  if (opts.realmId)   conditions.push(eq(memories.realmId, opts.realmId))
  if (opts.projectId) conditions.push(eq(memories.projectId, opts.projectId))
  conditions.push(inArray(memories.type, summaryBacklogTypes(opts.type)))

  const order = opts.oldestFirst ? memories.createdAt : desc(memories.createdAt)
  return db
    .select({
      id: memories.id,
      title: memories.title,
      aiTitle: memories.aiTitle,
      bodyMd: memories.bodyMd,
      type: memories.type,
      source: memories.source,
      createdAt: memories.createdAt,
      hasExecSummary: sql<boolean>`jsonb_array_length(${memories.execSummary}) > 0`,
      hasAiTitle: sql<boolean>`${memories.aiTitle} IS NOT NULL`,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(order)
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0)
}

type GraphOpts = { realmId?: string; includeArchived?: boolean }

export type GraphNode = {
  id: string
  title: string
  aiTitle: string | null
  type: string
  source: string
  realmId: string | null
  projectId: string | null
  taskId: string | null
  repo: string | null
  tags: string[]
  pinned: boolean
  createdAt: Date
  dominionId: string | null
  dominionName: string | null
  dominionColor: string | null
}

export type GraphEdge = {
  source: string
  target: string
  type: string
  note: string | null
}

export async function getGraphForUser(
  userId: string,
  opts: GraphOpts = {}
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const conditions = [eq(memories.userId, userId)]
  if (!opts.includeArchived) conditions.push(sql`${memories.archivedAt} IS NULL`)
  if (opts.realmId) conditions.push(eq(memories.realmId, opts.realmId))

  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      aiTitle: memories.aiTitle,
      type: memories.type,
      source: memories.source,
      realmId: memories.realmId,
      projectId: memories.projectId,
      taskId: memories.taskId,
      dominionId: memories.dominionId,
      tags: memories.tags,
      pinned: memories.pinned,
      createdAt: memories.createdAt,
      links: memories.links,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.pinned), desc(memories.createdAt))

  // Bulk-load dominion data — 3 parallel queries, zero N+1.
  const uniqueProjectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => id != null))]
  const [dominionRows, dominionRepoRows, projectDominionRows] = await Promise.all([
    db.select({ id: dominions.id, name: dominions.name, color: dominions.color })
      .from(dominions)
      .where(eq(dominions.userId, userId)),
    db.select({ dominionId: dominionRepos.dominionId, repoSlug: dominionRepos.repoSlug })
      .from(dominionRepos)
      .innerJoin(dominions, and(eq(dominionRepos.dominionId, dominions.id), eq(dominions.userId, userId))),
    uniqueProjectIds.length > 0
      ? db.select({ id: projects.id, dominionId: projects.dominionId })
          .from(projects)
          .where(inArray(projects.id, uniqueProjectIds))
      : Promise.resolve([] as Array<{ id: string; dominionId: string | null }>),
  ])

  const dominionMap = new Map(dominionRows.map((d) => [d.id, d]))
  const repoDominionMap = new Map(dominionRepoRows.map((r) => [r.repoSlug, r.dominionId]))
  const projectDominionMap = new Map(projectDominionRows.map((p) => [p.id, p.dominionId]))

  const ownedIds = new Set(rows.map((r) => r.id))
  const nodes: GraphNode[] = rows.map(({ links: _links, sourceMetadata, dominionId: memDominionId, ...rest }) => {
    const meta = (sourceMetadata ?? {}) as Record<string, unknown>
    const repo = typeof meta.repo === 'string' ? meta.repo : null

    const resolvedDominionId =
      memDominionId ??
      (rest.projectId ? (projectDominionMap.get(rest.projectId) ?? null) : null) ??
      (repo ? (repoDominionMap.get(repo) ?? null) : null)

    const dominion = resolvedDominionId ? dominionMap.get(resolvedDominionId) : null

    return {
      ...rest,
      repo,
      tags: (rest.tags ?? []) as string[],
      dominionId: resolvedDominionId,
      dominionName: dominion?.name ?? null,
      dominionColor: dominion?.color ?? null,
    }
  })

  const edges: GraphEdge[] = []
  const seenEdge = new Set<string>()
  const pushEdge = (source: string, target: string, type: string, note: string | null) => {
    if (source === target) return
    const a = source < target ? source : target
    const b = source < target ? target : source
    const key = `${a}|${b}|${type}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push({ source, target, type, note })
  }

  for (const row of rows) {
    const links = (row.links ?? []) as MemoryLink[]
    for (const link of links) {
      if (link.target_kind !== 'memory') continue
      if (!ownedIds.has(link.target)) continue
      pushEdge(row.id, link.target, link.type, link.note ?? null)
    }
  }

  // Synthetic edges: surface clustering signal when user-asserted links are
  // sparse. Marked with 'auto-*' types so the renderer can style them subtly.
  // Same-day chains memories captured within one calendar day in time order.
  // Shared-tag chains memories that share a tag (skip mega-tags > 30).
  const byDay = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const day = new Date(n.createdAt).toISOString().slice(0, 10)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(n)
    else byDay.set(day, [n])
  }
  for (const group of byDay.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (let i = 0; i < group.length - 1; i++) {
      pushEdge(group[i].id, group[i + 1].id, 'auto-day', null)
    }
  }

  const byTag = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    for (const tag of n.tags ?? []) {
      const bucket = byTag.get(tag)
      if (bucket) bucket.push(n)
      else byTag.set(tag, [n])
    }
  }
  for (const group of byTag.values()) {
    if (group.length < 2 || group.length > 30) continue
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (let i = 0; i < group.length - 1; i++) {
      pushEdge(group[i].id, group[i + 1].id, 'auto-tag', null)
    }
  }

  // Shared-repo: chain memories that come from the same repo (in temporal
  // order). Produces the dense per-repo cluster shape seen in the concept.
  const byRepo = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    if (!n.repo) continue
    const bucket = byRepo.get(n.repo)
    if (bucket) bucket.push(n)
    else byRepo.set(n.repo, [n])
  }
  for (const group of byRepo.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    // Chain consecutive + bridge every 3rd hop for richer connectivity.
    for (let i = 0; i < group.length - 1; i++) {
      pushEdge(group[i].id, group[i + 1].id, 'auto-repo', null)
    }
    for (let i = 0; i + 3 < group.length; i += 3) {
      pushEdge(group[i].id, group[i + 3].id, 'auto-repo', null)
    }
  }

  const byDominion = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    if (!n.dominionId) continue
    const bucket = byDominion.get(n.dominionId)
    if (bucket) bucket.push(n)
    else byDominion.set(n.dominionId, [n])
  }
  for (const group of byDominion.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (let i = 0; i < group.length - 1; i++) {
      pushEdge(group[i].id, group[i + 1].id, 'auto-dominion', null)
    }
    for (let i = 0; i + 3 < group.length; i += 3) {
      pushEdge(group[i].id, group[i + 3].id, 'auto-dominion', null)
    }
  }

  return { nodes, edges }
}

export async function searchMemoriesFts(userId: string, input: SearchMemoriesInput) {
  // Kairos Phase 3B — `query` is optional when scoped by `dominionId`. When
  // no query is given, drop the FTS match condition and rank/snippet
  // expressions; sort by recency instead. Result row shape stays identical
  // (rank=0, snippet='') so callers don't branch on response shape.
  const hasQuery = Boolean(input.query)
  const tsQuery = hasQuery ? sql`websearch_to_tsquery('english', ${input.query})` : null
  const rank = hasQuery
    ? sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
    : sql<number>`0::float4`
  const snippet = hasQuery
    ? sql<string>`ts_headline('english', coalesce(${memories.summary}, ${memories.bodyMd}), ${tsQuery}, 'MaxFragments=2,MaxWords=18,MinWords=5')`
    : sql<string>`''::text`

  const conditions = [
    eq(memories.userId, userId),
    sql`${memories.archivedAt} IS NULL`,
    isNull(memories.supersededAt),
  ]
  if (hasQuery) conditions.push(sql`"memories"."fts" @@ ${tsQuery}`)

  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(inArray(memories.type, types))
  }
  if (input.source) {
    const sources = Array.isArray(input.source) ? input.source : [input.source]
    conditions.push(sql`${memories.source} = ANY(${sources})`)
  }
  if (input.realmId)    conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId)  conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)     conditions.push(eq(memories.taskId, input.taskId))
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))
  if (input.sinceDays !== undefined) {
    conditions.push(sql`${memories.createdAt} >= NOW() - make_interval(days => ${input.sinceDays})`)
  }
  if (input.pinnedOnly) conditions.push(eq(memories.pinned, true))
  if (input.tagsAny && input.tagsAny.length > 0) {
    conditions.push(sql`${memories.tags} ?| ${input.tagsAny}::text[]`)
  }
  if (input.tagsAll && input.tagsAll.length > 0) {
    conditions.push(sql`${memories.tags} ?& ${input.tagsAll}::text[]`)
  }

  const orderBy = hasQuery
    ? [desc(rank), desc(memories.pinned), desc(memories.createdAt)]
    : [desc(memories.pinned), desc(memories.createdAt)]

  const hits = await db
    .select({
      ...SLIM_COLUMNS,
      rank,
      snippet,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(input.limit)
    .offset(input.offset)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions))

  return { hits, total }
}

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 (P2) — semantic vector search (hybrid retrieval's second leg).
//
// Flat `ORDER BY embedding <=> $vec LIMIT n` so the HNSW index is actually
// used (pgvector's planner skips HNSW inside CTEs / behind heavy filters).
// Runs in a transaction with `SET LOCAL hnsw.ef_search` so recall is bounded
// above the LIMIT and the GUC auto-reverts on commit (never leaks across the
// pooled Neon connection). Returns SLIM rows in nearest-first order; callers
// fuse with the FTS hit list via RRF. Embeddings from different models are not
// comparable — the active model is enforced at write time, not here.
// ─────────────────────────────────────────────────────────────────────────

type VectorSearchInput = {
  realmId?: string
  projectId?: string
  taskId?: string
  dominionId?: string
  type?: string | string[]
  limit: number
}

export async function vectorSearchMemories(
  userId: string,
  queryVec: number[],
  input: VectorSearchInput,
) {
  const vecLiteral = toVectorLiteral(queryVec)
  const distance = sql`${memories.embedding} <=> ${vecLiteral}::vector`

  const conditions = [
    eq(memories.userId, userId),
    sql`${memories.archivedAt} IS NULL`,
    isNull(memories.supersededAt),
    sql`${memories.embedding} IS NOT NULL`,
  ]
  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(inArray(memories.type, types))
  }
  if (input.realmId)    conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId)  conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)     conditions.push(eq(memories.taskId, input.taskId))
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
    return tx
      .select(SLIM_COLUMNS)
      .from(memories)
      .where(and(...conditions))
      .orderBy(distance)
      .limit(input.limit)
  })
}

// Reciprocal Rank Fusion (Cormack et al.) — fuse N ranked id lists in rank
// space. Score-scale-agnostic: only positions matter, so FTS ts_rank and
// vector cosine never need to be normalised against each other. k=60 is the
// literature default. Per-list weights bias one signal without breaking RRF.
const RRF_K = 60

function rrfFuse(lists: Array<{ ids: string[]; weight: number }>, k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const { ids, weight } of lists) {
    ids.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + i + 1))
    })
  }
  return scores
}

type NeighbourRow = {
  id: string
  title: string
  summary: string | null
  type: string
  source: string
  createdAt: Date
  edgeType: string
  edgeNote: string | null
  direction: 'outgoing' | 'incoming'
  distance: number
}

export async function getNeighbours(
  memoryId: string,
  userId: string,
  opts: { hops?: 1 | 2; includeReverse?: boolean; limit?: number } = {}
) {
  const hops = opts.hops ?? 1
  const includeReverse = opts.includeReverse ?? true
  const limit = opts.limit ?? 20

  // Outgoing walk: recursive CTE following links[].target where target_kind='memory'.
  const outgoingResult = await db.execute(sql`
    WITH RECURSIVE walk AS (
      SELECT
        m.id, m.user_id, m.links,
        0::int AS hop,
        NULL::text AS edge_type,
        NULL::text AS edge_note
      FROM memories m
      WHERE m.id = ${memoryId} AND m.user_id = ${userId}

      UNION ALL

      SELECT
        m2.id, m2.user_id, m2.links,
        w.hop + 1,
        (l->>'type')::text AS edge_type,
        (l->>'note')::text AS edge_note
      FROM walk w
      JOIN memories m1 ON m1.id = w.id
      CROSS JOIN LATERAL jsonb_array_elements(m1.links) AS l
      JOIN memories m2 ON m2.id = (l->>'target')::uuid AND m2.user_id = w.user_id
      WHERE w.hop < ${hops}
        AND (l->>'target_kind') = 'memory'
        AND m2.archived_at IS NULL
    )
    SELECT DISTINCT ON (n.id)
      n.id, n.hop AS distance, n.edge_type, n.edge_note,
      m.title, m.summary, m.type, m.source, m.created_at
    FROM walk n
    JOIN memories m ON m.id = n.id
    WHERE n.hop > 0
    ORDER BY n.id, n.hop
    LIMIT ${limit}
  `)

  const outgoing: NeighbourRow[] = (outgoingResult.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
    type: r.type as string,
    source: r.source as string,
    createdAt: r.created_at as Date,
    edgeType: r.edge_type as string,
    edgeNote: (r.edge_note as string | null) ?? null,
    direction: 'outgoing',
    distance: r.distance as number,
  }))

  let incoming: NeighbourRow[] = []
  if (includeReverse) {
    const incomingResult = await db.execute(sql`
      SELECT
        m.id, m.title, m.summary, m.type, m.source, m.created_at,
        (l->>'type')::text   AS edge_type,
        (l->>'note')::text   AS edge_note,
        1::int               AS distance
      FROM memories m
      CROSS JOIN LATERAL jsonb_array_elements(m.links) AS l
      WHERE m.user_id = ${userId}
        AND (l->>'target')::uuid = ${memoryId}
        AND (l->>'target_kind') = 'memory'
        AND m.archived_at IS NULL
      LIMIT ${limit}
    `)

    incoming = (incomingResult.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      summary: (r.summary as string | null) ?? null,
      type: r.type as string,
      source: r.source as string,
      createdAt: r.created_at as Date,
      edgeType: r.edge_type as string,
      edgeNote: (r.edge_note as string | null) ?? null,
      direction: 'incoming',
      distance: r.distance as number,
    }))
  }

  return [...outgoing, ...incoming]
}

export async function createMemory(userId: string, input: CreateMemoryParams) {
  // Idempotency for Claude-captured sessions: a given sessionId is a stable
  // identity, so re-posting (from a SessionStart backfill, re-invoked hook,
  // or manual recovery) should never duplicate. Other sources stay strict.
  const sessionId =
    input.source === 'claude' &&
    typeof input.sourceMetadata === 'object' &&
    input.sourceMetadata !== null
      ? (input.sourceMetadata as Record<string, unknown>).sessionId
      : undefined
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    const [existing] = await db
      .select()
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.source, 'claude'),
        sql`${memories.sourceMetadata}->>'sessionId' = ${sessionId}`,
      ))
      .limit(1)
    if (existing) return existing
  }

  const resolvedDominionId = input.dominionId == null
    ? await resolveDominionForMemory(userId, {
        projectId: input.projectId,
        sourceMetadata: (input.sourceMetadata ?? null) as Record<string, unknown> | null,
      })
    : null

  const [row] = await db
    .insert(memories)
    .values({
      userId,
      title: input.title,
      aiTitle: input.aiTitle ?? null,
      bodyMd: input.bodyMd,
      summary: input.summary ?? null,
      execSummary: input.execSummary ?? [],
      type: input.type,
      source: input.source,
      sourceMetadata: input.sourceMetadata ?? {},
      realmId: input.realmId ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      dominionId: input.dominionId ?? resolvedDominionId ?? null,
      tags: input.tags ?? [],
      links: input.links ?? [],
      pinned: input.pinned ?? false,
      confidence: confidenceForStreamClass(input.streamClass ?? 'idea'),
      // Drizzle skips undefined keys → DB default ('idea') applies when
      // caller omits streamClass. Internal callers (dispatcher) set it
      // explicitly for advisory / trace writes.
      ...(input.streamClass ? { streamClass: input.streamClass } : {}),
    })
    .returning()
  return row
}

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (A2) — generic capture endpoint backing function.
//
// The capture endpoint is the single ingestion point for any inbound source:
// Aeon board events, Slack/Teams/email webhooks, mobile/voice, browser
// extension, future channels. Callers POST a normalised payload; this
// function performs:
//   1. Channel normalisation: if `channel` is set, source becomes 'webhook'
//      and sourceMetadata.channel records the origin.
//   2. externalId idempotency: if sourceMetadata.externalId is set, any
//      existing memory with the same (source, externalId) is returned
//      instead of creating a duplicate. Crucial for webhooks that may
//      retry.
// Everything else delegates to createMemory (which still handles Claude
// sessionId idempotency for that source).
// ─────────────────────────────────────────────────────────────────────────

export interface CaptureMemoryInput extends Omit<CreateMemoryInput, 'sourceMetadata'> {
  channel?: string | null
  sourceMetadata?: Record<string, unknown>
  // Internal-only: forwarded to createMemory. See CreateMemoryParams above.
  streamClass?: StreamClass
}

export interface CaptureMemoryResult {
  memory: typeof memories.$inferSelect
  created: boolean
}

export async function captureMemory(userId: string, input: CaptureMemoryInput): Promise<CaptureMemoryResult> {
  const metadata: Record<string, unknown> = { ...(input.sourceMetadata ?? {}) }
  let source = input.source

  if (input.channel) {
    source = 'webhook'
    metadata.channel = input.channel
  }

  const externalId = typeof metadata.externalId === 'string' ? metadata.externalId : undefined
  if (externalId) {
    // Dedup only against LIVE rows. An archived row with the same externalId
    // means the operator deliberately took it out of circulation (e.g.
    // "regenerate today's briefing"); a fresh capture should create a new
    // memory rather than resurrect the stale one.
    const [existing] = await db
      .select()
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.source, source),
        sql`${memories.sourceMetadata}->>'externalId' = ${externalId}`,
        isNull(memories.archivedAt),
      ))
      .limit(1)
    if (existing) return { memory: existing, created: false }
  }

  const memory = await createMemory(userId, {
    ...input,
    source,
    sourceMetadata: metadata,
  })
  return { memory, created: true }
}

// Kairos Phase 2 (B3) — owner reflection capture.
//
// Reflections are the operator's first-class signal: beliefs, priorities,
// observations, corrections fired from anywhere (MCP today, phone tomorrow).
// They carry HIGHER weight than activity-derived memories in archetype and
// cortex generation, and they can override drift flags.
//
// streamClass is forced to 'reflection' so the synthesis prompts pick them
// up as the weighted block — this is why we bypass createMemorySchema and
// insert directly: the schema does not (and should not) expose streamClass
// to public callers, but the contract for *this* function is exactly that.
// See docs/kairos/12-kairos-evolution-plan.md §"Reflections — the owner's
// signal" and docs/kairos/14-quality-gates.md §5 (reflection weight).
export interface CaptureReflectionInput {
  dominionId: string
  bodyMd: string
  title?: string | null
  summary?: string | null
  tags?: string[]
  source?: 'manual' | 'claude' | 'voice' | 'webhook'
  sourceMetadata?: Record<string, unknown>
}

export type CaptureReflectionResult =
  | { ok: true; memory: typeof memories.$inferSelect }
  | { ok: false; reason: 'dominion_not_found' }

export async function captureReflection(
  userId: string,
  input: CaptureReflectionInput,
): Promise<CaptureReflectionResult> {
  // Verify ownership inline rather than calling findDominionById to avoid
  // an extra round-trip + a circular-ish import (this module is sibling to
  // dominions.ts and they already cross-reference).
  const [dom] = await db
    .select({ id: dominions.id, name: dominions.name })
    .from(dominions)
    .where(and(
      eq(dominions.id, input.dominionId),
      eq(dominions.userId, userId),
      isNull(dominions.archivedAt),
    ))
    .limit(1)
  if (!dom) return { ok: false, reason: 'dominion_not_found' }

  // Default title is the first non-empty line of the body, with leading
  // markdown markers (#, -, *, >, backticks) stripped so the cosmic-view
  // label reads as prose rather than as raw markup. Caps at 80 chars.
  const firstLine = input.bodyMd.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const stripped = firstLine.replace(/^([#>*\-`]+\s*)+/, '').trim()
  const fallbackTitle = stripped.slice(0, 80) || 'Reflection'
  const title = (input.title?.trim() || fallbackTitle).slice(0, 255)

  const [memory] = await db
    .insert(memories)
    .values({
      userId,
      dominionId: input.dominionId,
      title,
      bodyMd: input.bodyMd,
      summary: input.summary ?? null,
      type: 'reflection',
      streamClass: 'reflection',
      confidence: confidenceForStreamClass('reflection'),
      source: input.source ?? 'manual',
      sourceMetadata: {
        ...(input.sourceMetadata ?? {}),
        // Stamp the canonical channel so future audit queries can
        // distinguish kairos_reflect captures from generic note creates.
        kairosReflect: true,
      },
      tags: input.tags?.slice(0, 50) ?? [],
      // Reflections are not auto-pinned — `streamClass='reflection'`
      // already carries higher weight in synthesis. Pinning is reserved
      // for the operator's explicit "always show me this" gesture.
      pinned: false,
    })
    .returning()

  return { ok: true, memory }
}

// Notes polish — list memories Kairos auto-captured today (sources other
// than manual / voice / import). Surfaces what the system has been logging
// on the operator's behalf in a single horizontal strip on /notes.
export async function listAutoCapturedToday(userId: string, limit = 30) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  return db
    .select({
      id: memories.id,
      title: memories.title,
      aiTitle: memories.aiTitle,
      summary: memories.summary,
      type: memories.type,
      source: memories.source,
      createdAt: memories.createdAt,
      dominionId: memories.dominionId,
      dominionName: dominions.name,
      dominionColor: dominions.color,
    })
    .from(memories)
    .leftJoin(dominions, eq(memories.dominionId, dominions.id))
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      sql`${memories.createdAt} >= ${startOfDay}`,
      inArray(memories.source, ['claude', 'cron', 'system', 'webhook', 'hook']),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
}

// Kairos Phase 2 (E22) — list recent advisories across the last N days.
// Joins with dominions so the feed can render Dominion pills.
export async function listRecentAdvisories(
  userId: string,
  opts: { days?: number; limit?: number } = {},
) {
  const days = Math.min(Math.max(opts.days ?? 3, 1), 30)
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  return db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      createdAt: memories.createdAt,
      dominionId: memories.dominionId,
      dominionName: dominions.name,
      dominionColor: dominions.color,
    })
    .from(memories)
    .leftJoin(dominions, eq(memories.dominionId, dominions.id))
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      sql`${memories.createdAt} >= ${since}`,
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
}

// Kairos Phase 1.5 — list today's Briefer-generated advisories for a user,
// joined with the Dominion they're scoped to so the dashboard card can
// render "<Dominion name>" headers without a second query.
export async function listTodaysAdvisories(userId: string, isoDate?: string) {
  const date = isoDate ?? new Date().toISOString().slice(0, 10)
  return db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      createdAt: memories.createdAt,
      dominionId: memories.dominionId,
      dominionName: dominions.name,
      dominionColor: dominions.color,
    })
    .from(memories)
    .leftJoin(dominions, eq(memories.dominionId, dominions.id))
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      eq(memories.source, 'cron'),
      sql`${memories.sourceMetadata}->>'briefingDate' = ${date}`,
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
}

export async function updateMemory(memoryId: string, userId: string, patch: UpdateMemoryInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined)      update.title = patch.title
  if (patch.aiTitle !== undefined)    update.aiTitle = patch.aiTitle
  if (patch.bodyMd !== undefined)     update.bodyMd = patch.bodyMd
  if (patch.summary !== undefined)    update.summary = patch.summary
  if (patch.execSummary !== undefined) update.execSummary = patch.execSummary
  if (patch.type !== undefined)       update.type = patch.type
  if (patch.realmId !== undefined)    update.realmId = patch.realmId
  if (patch.projectId !== undefined)  update.projectId = patch.projectId
  if (patch.taskId !== undefined)     update.taskId = patch.taskId
  if (patch.dominionId !== undefined) update.dominionId = patch.dominionId
  if (patch.tags !== undefined)       update.tags = patch.tags
  if (patch.pinned !== undefined)     update.pinned = patch.pinned
  if (patch.archivedAt !== undefined) update.archivedAt = patch.archivedAt ? new Date(patch.archivedAt) : null

  // Brain Phase 4 (P2) — the embedding is derived from title+summary+body. If
  // any of those change, drop the vector so the backfill re-embeds this row.
  if (patch.title !== undefined || patch.summary !== undefined || patch.bodyMd !== undefined) {
    update.embedding = null
    update.embeddingModel = null
  }

  const [row] = await db
    .update(memories)
    .set(update)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()
  return row ?? null
}

export async function addLink(memoryId: string, userId: string, input: AddLinkInput) {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory) return null

  const existing = (memory.links as MemoryLink[]) ?? []
  const newLink: MemoryLink = {
    type: input.type,
    target: input.target,
    target_kind: input.targetKind,
    ...(input.note ? { note: input.note } : {}),
  }

  // Dedup: same (target, target_kind, type) returns existing edge unchanged.
  const dup = existing.find(
    (l) => l.target === newLink.target && l.target_kind === newLink.target_kind && l.type === newLink.type
  )
  if (dup) return { memory, link: dup, linksCount: existing.length, created: false }

  const next = [...existing, newLink]
  const [updated] = await db
    .update(memories)
    .set({ links: next, updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()

  return { memory: updated, link: newLink, linksCount: next.length, created: true }
}

export async function removeLink(memoryId: string, userId: string, linkIndex: number) {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory) return null
  const existing = (memory.links as MemoryLink[]) ?? []
  if (linkIndex < 0 || linkIndex >= existing.length) return null
  const next = existing.filter((_, i) => i !== linkIndex)
  const [updated] = await db
    .update(memories)
    .set({ links: next, updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()
  return updated ?? null
}

// Kairos Phase 2 (E22) — soft-archive a memory. Used by the advisory feed
// for Acknowledge / Defer actions: the memory persists for retrospection
// but stops surfacing in the feed.
export async function archiveMemory(memoryId: string, userId: string) {
  const [row] = await db
    .update(memories)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()
  return row ?? null
}

export type AcceptProposalResult =
  | { ok: true; memory: typeof memories.$inferSelect }
  | { ok: false; reason: 'not_a_proposal' }

// Guided introspection — promote a staged proposal (a type='inbound' memory
// Kairos proposed, carrying its citation links) into a committed, operator-
// endorsed memory. This is the operator gate in propose-not-commit: nothing
// becomes a belief until accepted here (or, equivalently, rewritten via
// kairos_reflect). Optionally supersedes the beliefs it replaces — stamped,
// never deleted, so the trail stays honest. Returns null if the memory isn't
// found; { ok:false } if it isn't a pending proposal.
export async function acceptProposal(
  memoryId: string,
  userId: string,
  input: AcceptProposalInput,
): Promise<AcceptProposalResult | null> {
  const proposal = await findMemoryById(memoryId, userId)
  if (!proposal) return null

  const meta = (proposal.sourceMetadata ?? {}) as Record<string, unknown>
  if (proposal.type !== 'inbound' || meta.introspection !== true) {
    return { ok: false, reason: 'not_a_proposal' }
  }

  const kind = typeof meta.kind === 'string' ? meta.kind : 'reflection'
  const committedType = input.asType ?? committedTypeForKind(kind)
  const committedStream = committedType === 'note' ? 'idea' : 'reflection'
  const now = new Date()

  const existingLinks = (proposal.links as MemoryLink[]) ?? []
  const supersedeIds = input.supersedes ?? []
  const supersedeLinks: MemoryLink[] = supersedeIds.map((target) => ({
    type: 'supersedes',
    target,
    target_kind: 'memory',
  }))

  const [updated] = await db
    .update(memories)
    .set({
      type: committedType,
      streamClass: committedStream,
      confidence: confidenceForStreamClass(committedStream),
      pinned: input.pin ?? false,
      links: [...existingLinks, ...supersedeLinks],
      sourceMetadata: { ...meta, status: 'accepted', acceptedAt: now.toISOString(), promotedFrom: 'inbound' },
      updatedAt: now,
    })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()

  // Stamp the superseded beliefs (user-scoped). Soft pointer + timestamp; the
  // rows stay queryable for time-travel, they just stop being "current".
  if (supersedeIds.length > 0) {
    await db
      .update(memories)
      .set({ supersededAt: now, supersededById: memoryId, updatedAt: now })
      .where(and(eq(memories.userId, userId), inArray(memories.id, supersedeIds)))
  }

  return updated ? { ok: true, memory: updated } : null
}

export async function deleteMemory(memoryId: string, userId: string) {
  const [deleted] = await db
    .delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning({ id: memories.id })
  return !!deleted
}

export async function countMemories(userId: string) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(eq(memories.userId, userId), sql`${memories.archivedAt} IS NULL`))
  return count
}

// Helper used by the daily-log export and the daily-briefing cron (Phase 5).
export async function findMemoriesCreatedOn(userId: string, dateIso: string) {
  return db
    .select(SLIM_COLUMNS)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.createdAt}::date = ${dateIso}::date`,
      sql`${memories.archivedAt} IS NULL`,
    ))
    .orderBy(desc(memories.createdAt))
}

// Helper used by exporter: stream all of a user's memories sorted by realm, then created_at.
export async function findAllMemoriesForExport(userId: string) {
  return db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(memories.realmId, memories.createdAt)
}

// Used by addLink validation when targetKind === 'memory': verify target memory exists
// and is owned by the same user. Returns true if the target is reachable.
export async function targetMemoryExists(targetId: string, userId: string) {
  const [row] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.id, targetId), eq(memories.userId, userId)))
    .limit(1)
  return !!row
}

// Batch fetch full memories by id, user-scoped. Used by prepareContext to
// pull bodies only for the subset of candidates that will actually be packed
// — avoids loading bodyMd for the entire search/graph result set.
export async function findMemoriesByIds(ids: string[], userId: string) {
  if (ids.length === 0) return []
  return db
    .select()
    .from(memories)
    .where(and(
      inArray(memories.id, ids),
      eq(memories.userId, userId),
      sql`${memories.archivedAt} IS NULL`,
    ))
}

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 (P2) — embedding backfill. Embeds rows that have no vector yet
// (or whose vector came from a model other than the active provider). Embeds
// `title + summary + body` as a "document" so retrieval can use asymmetric
// query/document embeddings. Idempotent + incremental: returns how many it
// embedded and how many remain, so the caller (cron/script) can loop to drain.
// No-op when no embedding provider is configured.
// ─────────────────────────────────────────────────────────────────────────
export async function backfillEmbeddings(
  opts: { userId?: string; limit?: number } = {},
): Promise<{ embedded: number; remaining: number; skipped?: 'embeddings_disabled' }> {
  const model = activeEmbeddingModel()
  if (!model) return { embedded: 0, remaining: 0, skipped: 'embeddings_disabled' }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)

  const staleFilter = sql`(${memories.embedding} IS NULL OR ${memories.embeddingModel} IS DISTINCT FROM ${model})`
  const conditions = [sql`${memories.archivedAt} IS NULL`, staleFilter]
  if (opts.userId) conditions.push(eq(memories.userId, opts.userId))

  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      bodyMd: memories.bodyMd,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(memories.createdAt)
    .limit(limit)

  if (rows.length === 0) return { embedded: 0, remaining: 0 }

  const texts = rows.map((r) =>
    [r.title, r.summary ?? '', r.bodyMd].filter(Boolean).join('\n\n'),
  )
  const vectors = await embedTexts(texts, 'document')
  if (!vectors) return { embedded: 0, remaining: rows.length, skipped: 'embeddings_disabled' }

  let embedded = 0
  for (let i = 0; i < rows.length; i++) {
    const vec = vectors[i]
    if (!vec) continue
    await db
      .update(memories)
      .set({ embedding: vec, embeddingModel: model })
      .where(eq(memories.id, rows[i].id))
    embedded++
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions))

  return { embedded, remaining }
}

// ─────────────────────────────────────────────────────────────────────────
// Consolidation — embedding dedup pass. Collapses near-duplicate memories
// (within the same machine-generated type) by superseding the redundant rows
// against one canonical — stamped (superseded_at / superseded_by_id), never
// deleted, so the belief trail stays time-travelable and retrieval (which now
// filters `superseded_at IS NULL`) simply stops surfacing them. Operator-
// authored types are excluded here — those go through a propose-not-commit
// pass. Self-join over the same (user, type) finds candidate pairs by cosine
// distance; clustering + canonical selection are pure (lib/kairos/dedup.ts).
// ─────────────────────────────────────────────────────────────────────────
export async function dedupMemories(
  opts: {
    userId?: string
    types?: readonly string[]
    threshold?: number
    dryRun?: boolean
  } = {},
): Promise<{ clusters: number; superseded: number; dryRun: boolean }> {
  const types = opts.types?.length ? [...opts.types] : [...AUTO_DEDUP_TYPES]
  const maxDist = 1 - (opts.threshold ?? DEFAULT_DEDUP_THRESHOLD)
  const dryRun = opts.dryRun ?? false

  // `a.user_id = b.user_id` keeps merges strictly within a single user's brain
  // (multi-tenant safe). `a.id < b.id` dedups the unordered pair.
  const typeList = sql.join(types.map((t) => sql`${t}`), sql`, `)
  const userScope = opts.userId ? sql`AND a.user_id = ${opts.userId}` : sql``
  const res = await db.execute(sql`
    SELECT a.id AS a, b.id AS b
    FROM memories a
    JOIN memories b
      ON a.user_id = b.user_id AND a.type = b.type AND a.id < b.id
    WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
      AND a.superseded_at IS NULL AND b.superseded_at IS NULL
      AND a.archived_at IS NULL AND b.archived_at IS NULL
      AND a.type IN (${typeList})
      AND (a.embedding <=> b.embedding) < ${maxDist}
      ${userScope}
  `)
  const pairs = (res.rows as Array<{ a: string; b: string }>).map(
    (r) => [r.a, r.b] as [string, string],
  )
  const clusters = buildClusters(pairs)
  if (clusters.length === 0) return { clusters: 0, superseded: 0, dryRun }

  const meta = await db
    .select({
      id: memories.id,
      pinned: memories.pinned,
      confidence: memories.confidence,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(inArray(memories.id, clusters.flat()))
  const byId = new Map(meta.map((m) => [m.id, m]))

  let superseded = 0
  for (const cluster of clusters) {
    const cands = cluster
      .map((id) => byId.get(id))
      .filter((m): m is DedupCandidate => Boolean(m))
    if (cands.length < 2) continue
    const { canonicalId, loserIds } = pickCanonical(cands)
    if (loserIds.length === 0) continue
    if (!dryRun) {
      await db
        .update(memories)
        .set({ supersededAt: new Date(), supersededById: canonicalId })
        .where(and(inArray(memories.id, loserIds), isNull(memories.supersededAt)))
    }
    superseded += loserIds.length
  }
  return { clusters: clusters.length, superseded, dryRun }
}

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 — prepare_context. Single retrieval call that returns a
// budget-packed markdown bundle ready to drop into an AI context window.
//
// Algorithm:
//   1. BM25 FTS search for candidates (top-K = maxSources)
//   2. Pinned fetch (always or per includePinned flag), user-scoped, realm-scoped
//   3. 1-hop graph walk from top-10 hits (in parallel) for typed neighbours
//   4. Composite score = baseScore × (1 + recencyDecay × 0.3)
//        - baseScore: pinned=2.0, hit=rank, neighbour=parentRank*0.5 + edgeBonus
//        - recency: exp(-daysOld / 14) — 14-day half-life
//   5. Sort, fetch full bodies for top items
//   6. Pack into Pinned (≤30% budget, full body) → Most relevant (≤70% budget,
//      full body) → Related (rest, summary only) until budget exhausted
//   7. Return markdown + token estimate + source citations
//
// Token estimate uses a rough chars/4 heuristic — good enough for budget
// guard rails; tiktoken refinement is a Phase 5 polish if needed.
// ─────────────────────────────────────────────────────────────────────────

const EDGE_BONUS: Record<string, number> = {
  supports:        0.5,
  contradicts:     0.4,
  supersedes:      0.3,
  refers_to:       0.3,
  relates:         0.2,
  blocks_thinking: 0.1,
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

function recencyDecay(createdAt: Date): number {
  const daysOld = (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  return Math.exp(-daysOld / 14)
}

type Candidate = {
  id: string
  title: string
  summary: string | null
  type: string
  source: string
  createdAt: Date
  pinned: boolean
  baseScore: number
  origin: 'pinned' | 'hit' | 'neighbour'
  snippet?: string  // populated for FTS hits
  edgeType?: string // populated for neighbours
}

type FtsHits = Awaited<ReturnType<typeof searchMemoriesFts>>['hits']
type VecHits = Awaited<ReturnType<typeof vectorSearchMemories>>

// Merge FTS + vector hit lists into one RRF-ranked list shaped like the FTS
// hits, so the downstream candidate builder needs no changes. FTS rows win on
// metadata (they carry the ts_headline snippet); vector-only rows fold in with
// an empty snippet. Each row's `rank` is replaced by its fused RRF score.
function fuseHybrid(ftsHits: FtsHits, vecHits: VecHits): FtsHits {
  const rrf = rrfFuse([
    { ids: ftsHits.map((h) => h.id), weight: 1 },
    { ids: vecHits.map((h) => h.id), weight: 1 },
  ])
  const byId = new Map<string, FtsHits[number]>()
  for (const h of ftsHits) byId.set(h.id, h)
  for (const h of vecHits) {
    if (!byId.has(h.id)) byId.set(h.id, { ...h, rank: 0, snippet: '' })
  }
  return [...byId.values()]
    .map((h) => ({ ...h, rank: rrf.get(h.id) ?? 0 }))
    .sort((a, b) => b.rank - a.rank)
}

export async function prepareContext(userId: string, input: PrepareContextInput) {
  const budget = input.budgetTokens
  const realmId = input.realmId

  // ── 1. FTS search ────────────────────────────────────────────────────
  const search = await searchMemoriesFts(userId, {
    query: input.query,
    realmId,
    type: input.type,
    limit: input.maxSources,
    offset: 0,
  })
  let hits = search.hits

  // ── 1b. Hybrid: fuse a semantic vector search via RRF. Best-effort — if
  //        embeddings are disabled or the embedding call fails, we keep the
  //        FTS result set untouched (graceful degradation, prod-safe). ─────
  if (input.query && embeddingsEnabled()) {
    try {
      const queryVec = await embedOne(input.query, 'query')
      if (queryVec) {
        const vecHits = await vectorSearchMemories(userId, queryVec, {
          realmId,
          type: input.type,
          limit: input.maxSources,
        })
        hits = fuseHybrid(hits, vecHits)
      }
    } catch (err) {
      console.warn('[prepareContext] semantic search failed, FTS-only:', err instanceof Error ? err.message : err)
    }
  }

  // ── 2. Pinned fetch (user-scoped, realm-scoped if provided) ──────────
  const pinned = input.includePinned
    ? await listMemories(userId, {
        pinnedOnly: true,
        realmId,
        limit: 20,
      })
    : []

  // ── 3. 1-hop graph walk in parallel from top-10 hits ─────────────────
  const seedIds = hits.slice(0, 10).map((h) => h.id)
  const parentRanks = new Map<string, number>()
  for (const h of hits.slice(0, 10)) parentRanks.set(h.id, h.rank)
  let neighbours: Array<{ id: string; title: string; summary: string | null; type: string; source: string; createdAt: Date; edgeType: string; parentId: string }> = []
  if (input.hops >= 1 && seedIds.length > 0) {
    const walks = await Promise.all(
      seedIds.map(async (sid) => {
        const rows = await getNeighbours(sid, userId, { hops: 1, includeReverse: true, limit: 5 })
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

  // ── 4. Build candidate set with composite scoring ────────────────────
  const seen = new Set<string>()
  const candidates: Candidate[] = []

  for (const p of pinned) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    candidates.push({
      id: p.id,
      title: p.title,
      summary: p.summary,
      type: p.type,
      source: p.source,
      createdAt: p.createdAt,
      pinned: true,
      baseScore: 2.0,
      origin: 'pinned',
    })
  }
  for (const h of hits) {
    if (seen.has(h.id)) continue
    seen.add(h.id)
    candidates.push({
      id: h.id,
      title: h.title,
      summary: h.summary,
      type: h.type,
      source: h.source,
      createdAt: h.createdAt,
      pinned: !!h.pinned,
      baseScore: h.rank,
      origin: 'hit',
      snippet: h.snippet,
    })
  }
  for (const n of neighbours) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    const parentRank = parentRanks.get(n.parentId) ?? 0
    const bonus = EDGE_BONUS[n.edgeType] ?? 0.1
    candidates.push({
      id: n.id,
      title: n.title,
      summary: n.summary,
      type: n.type,
      source: n.source,
      createdAt: n.createdAt,
      pinned: false,
      baseScore: parentRank * 0.5 + bonus,
      origin: 'neighbour',
      edgeType: n.edgeType,
    })
  }

  for (const c of candidates) {
    const recency = recencyDecay(c.createdAt)
    ;(c as Candidate & { compositeScore: number }).compositeScore = c.baseScore * (1 + recency * 0.3)
  }
  const scored = candidates as Array<Candidate & { compositeScore: number }>
  scored.sort((a, b) => b.compositeScore - a.compositeScore)

  // ── 5. Fetch full bodies for top items (cap at 40 — anything beyond
  //      that will land in Related as summary only) ─────────────────────
  const bodyFetchIds = scored.slice(0, 40).map((c) => c.id)
  const bodies = await findMemoriesByIds(bodyFetchIds, userId)
  const bodyById = new Map(bodies.map((b) => [b.id, b]))

  // ── 6. Pack into Pinned → Most relevant → Related sections ──────────
  const headerOverhead = 200  // tokens reserved for header + section titles + sources block
  const pinnedBudget   = Math.floor((budget - headerOverhead) * 0.30)
  const relevantBudget = Math.floor((budget - headerOverhead) * 0.55)
  // related gets the remainder

  const pinnedItems: Array<Candidate & { compositeScore: number; body: string }> = []
  const relevantItems: typeof pinnedItems = []
  const relatedItems: Array<Candidate & { compositeScore: number; summary: string | null }> = []

  let pinnedUsed = 0
  let relevantUsed = 0
  let relatedUsed = 0
  const relatedBudget = Math.max(budget - headerOverhead - pinnedBudget - relevantBudget, 200)

  for (const c of scored) {
    const body = bodyById.get(c.id)?.bodyMd ?? c.summary ?? ''
    const bodyTokens = estimateTokens(body) + estimateTokens(c.title) + 30  // body + title + section overhead

    if (c.origin === 'pinned' && pinnedUsed + bodyTokens <= pinnedBudget) {
      pinnedItems.push({ ...c, body })
      pinnedUsed += bodyTokens
      continue
    }
    if (relevantUsed + bodyTokens <= relevantBudget && relevantItems.length < 8) {
      relevantItems.push({ ...c, body })
      relevantUsed += bodyTokens
      continue
    }
    const summaryTokens = estimateTokens(c.summary ?? c.title) + 20
    if (relatedUsed + summaryTokens <= relatedBudget) {
      relatedItems.push({ ...c, summary: c.summary })
      relatedUsed += summaryTokens
    }
    // Else: drop. Sources block at end will still cite it.
  }

  // ── 7. Render markdown ───────────────────────────────────────────────
  const lines: string[] = []
  lines.push(`# Context for: ${input.query}`)
  lines.push('')
  lines.push(`> Budget: ${budget} tokens · Pinned: ${pinnedItems.length} · Relevant: ${relevantItems.length} · Related: ${relatedItems.length}`)
  lines.push('')

  if (pinnedItems.length > 0) {
    lines.push('## Pinned')
    lines.push('')
    for (const p of pinnedItems) {
      const date = new Date(p.createdAt).toISOString().slice(0, 10)
      lines.push(`### ${p.title}`)
      lines.push(`*${date} · ${p.type} · ${p.source}*`)
      lines.push('')
      lines.push(p.body)
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  if (relevantItems.length > 0) {
    lines.push('## Most relevant')
    lines.push('')
    for (const r of relevantItems) {
      const date = new Date(r.createdAt).toISOString().slice(0, 10)
      lines.push(`### ${r.title}`)
      lines.push(`*${date} · ${r.type} · ${r.source}${r.origin === 'neighbour' && r.edgeType ? ` · linked: ${r.edgeType}` : ''}*`)
      lines.push('')
      lines.push(r.body)
      lines.push('')
      lines.push('---')
      lines.push('')
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

  if (candidates.length === 0) {
    lines.push('_No matching memories found for this query._')
    lines.push('')
  }

  lines.push('## Sources')
  const sources: Array<{ id: string; title: string; score: number; section: 'pinned' | 'relevant' | 'related' }> = []
  for (const p of pinnedItems) sources.push({ id: p.id, title: p.title, score: Number(p.compositeScore.toFixed(3)), section: 'pinned' })
  for (const r of relevantItems) sources.push({ id: r.id, title: r.title, score: Number(r.compositeScore.toFixed(3)), section: 'relevant' })
  for (const r of relatedItems) sources.push({ id: r.id, title: r.title, score: Number(r.compositeScore.toFixed(3)), section: 'related' })
  for (const s of sources) lines.push(`- \`${s.id}\` · ${s.title} · score ${s.score} · ${s.section}`)

  const contextMd = lines.join('\n')
  const tokensUsed = estimateTokens(contextMd)

  return { contextMd, tokensUsed, sources }
}
