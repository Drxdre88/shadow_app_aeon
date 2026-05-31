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
} from './validators'
import { resolveDominionForMemory } from './dominions'

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
  if (opts.type) {
    const types = Array.isArray(opts.type) ? opts.type : [opts.type]
    conditions.push(sql`${memories.type} = ANY(${types})`)
  }

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
  const tsQuery = sql`websearch_to_tsquery('english', ${input.query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  const snippet = sql<string>`ts_headline('english', coalesce(${memories.summary}, ${memories.bodyMd}), ${tsQuery}, 'MaxFragments=2,MaxWords=18,MinWords=5')`

  const conditions = [
    eq(memories.userId, userId),
    sql`"memories"."fts" @@ ${tsQuery}`,
    sql`${memories.archivedAt} IS NULL`,
  ]

  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(sql`${memories.type} = ANY(${types})`)
  }
  if (input.source) {
    const sources = Array.isArray(input.source) ? input.source : [input.source]
    conditions.push(sql`${memories.source} = ANY(${sources})`)
  }
  if (input.realmId)   conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId) conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)    conditions.push(eq(memories.taskId, input.taskId))
  if (input.pinnedOnly) conditions.push(eq(memories.pinned, true))
  if (input.tagsAny && input.tagsAny.length > 0) {
    conditions.push(sql`${memories.tags} ?| ${input.tagsAny}::text[]`)
  }
  if (input.tagsAll && input.tagsAll.length > 0) {
    conditions.push(sql`${memories.tags} ?& ${input.tagsAll}::text[]`)
  }

  const hits = await db
    .select({
      ...SLIM_COLUMNS,
      rank,
      snippet,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(rank), desc(memories.pinned), desc(memories.createdAt))
    .limit(input.limit)
    .offset(input.offset)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions))

  return { hits, total }
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

export async function createMemory(userId: string, input: CreateMemoryInput) {
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
    const [existing] = await db
      .select()
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.source, source),
        sql`${memories.sourceMetadata}->>'externalId' = ${externalId}`,
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
  const hits = search.hits

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
