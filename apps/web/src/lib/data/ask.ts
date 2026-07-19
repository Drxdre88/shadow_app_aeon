import { db } from '@/lib/db'
import { boardTasks, dominions, memories, projectMembers, projects } from '@/lib/db/schema'
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import type { AetherPayload } from '@/lib/kairos/aether-types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Ask — pure DB queries. No business logic; all selection logic lives
// in lib/kairos/ask.ts. These functions are the data layer only.
// ─────────────────────────────────────────────────────────────────────────

export type KairosAskMeta = {
  status: 'pending' | 'answered' | 'expired'
  aetherMemoryId: string
  sourceThoughtId: string | null
  sourceMemoryIds: string[]
  dominionId: string | null
  askedAt: string
  expiresAt?: string
  answeredAt?: string
  answerMemoryId?: string
}

export type KairosAskMineMeta = {
  date: string
  kind: 'decision' | 'calibration' | 'doctrine' | 'retrospective' | 'revival' | 'premortem' | 'values'
  sourceMemoryIds: string[]
  leverage: number
  rationale?: string
}

export type KairosAskSourceSnippet = {
  id: string
  title: string
  body: string
}

export type KairosAskRow = {
  id: string
  title: string
  summary: string | null
  dominionId: string | null
  createdAt: Date
  kairosAsk: KairosAskMeta
  askMine?: KairosAskMineMeta
  expiresAt?: Date | null
}

function parseExpiry(metadata: Record<string, unknown>): Date | null {
  const raw = metadata.expiresAt
  if (typeof raw !== 'string') return null
  const expiresAt = new Date(raw)
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt
}

function parseAskRow(
  row: {
    id: string
    title: string
    summary: string | null
    dominionId: string | null
    createdAt: Date
    sourceMetadata: unknown
  },
  now: Date,
): KairosAskRow | null {
  const metadata = (row.sourceMetadata ?? {}) as Record<string, unknown>
  const storedAsk = metadata.kairosAsk as KairosAskMeta | undefined
  if (!storedAsk) return null
  const expiresAt = parseExpiry(metadata)
  const kairosAsk = storedAsk.status === 'pending' && expiresAt && expiresAt <= now
    ? { ...storedAsk, status: 'expired' as const }
    : storedAsk

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    dominionId: row.dominionId,
    createdAt: row.createdAt,
    kairosAsk,
    askMine: metadata.askMine as KairosAskMineMeta | undefined,
    expiresAt,
  }
}

/** Return the current pending kairos-ask memory, or null if none. */
export async function getPendingKairosAsk(userId: string): Promise<KairosAskRow | null> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      dominionId: memories.dominionId,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.type, 'advisory'),
        isNull(memories.archivedAt),
        sql`${memories.sourceMetadata}->>'kairosAskStatus' = 'pending'`,
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(20)

  const now = new Date()
  for (const row of rows) {
    const ask = parseAskRow(row, now)
    if (ask?.kairosAsk.status === 'pending') return ask
  }
  return null
}

export async function getKairosAskSourceSnippets(
  userId: string,
  sourceIds: string[],
): Promise<KairosAskSourceSnippet[]> {
  if (sourceIds.length === 0) return []

  const [memoryRows, taskRows] = await Promise.all([
    db
      .select({
        id: memories.id,
        title: memories.title,
        body: memories.bodyMd,
      })
      .from(memories)
      .where(and(eq(memories.userId, userId), inArray(memories.id, sourceIds))),
    db
      .selectDistinct({
        id: boardTasks.id,
        name: boardTasks.name,
        description: boardTasks.description,
        projectName: projects.name,
        status: boardTasks.status,
        priority: boardTasks.priority,
        updatedAt: boardTasks.updatedAt,
      })
      .from(boardTasks)
      .innerJoin(projects, eq(projects.id, boardTasks.projectId))
      .leftJoin(projectMembers, and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, userId),
      ))
      .where(and(
        inArray(boardTasks.id, sourceIds),
        or(eq(projects.userId, userId), eq(projectMembers.userId, userId)),
      )),
  ])

  const byId = new Map<string, KairosAskSourceSnippet>()
  for (const row of taskRows) {
    const taskState = `${row.projectName} · ${row.status} · ${row.priority} · updated ${row.updatedAt.toISOString()}`
    byId.set(row.id, {
      id: row.id,
      title: row.name,
      body: row.description?.trim() ? `${taskState}\n${row.description.trim()}` : taskState,
    })
  }
  for (const row of memoryRows) {
    byId.set(row.id, { id: row.id, title: row.title, body: row.body })
  }

  return sourceIds.flatMap((id) => {
    const source = byId.get(id)
    return source ? [source] : []
  })
}

export async function listRecentKairosAsks(
  userId: string,
  days = 14,
  now: Date = new Date(),
): Promise<KairosAskRow[]> {
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      dominionId: memories.dominionId,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      sql`${memories.sourceMetadata} ? 'kairosAsk'`,
      gte(memories.createdAt, cutoff),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(100)

  return rows.flatMap((row) => {
    const ask = parseAskRow(row, now)
    return ask ? [ask] : []
  })
}

export async function listKairosAsksAnsweredBetween(
  userId: string,
  start: Date,
  end: Date,
): Promise<Array<{ id: string; answeredAt: Date }>> {
  const rows = await db
    .select({
      id: memories.id,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'advisory'),
      sql`${memories.sourceMetadata}->'kairosAsk'->>'status' = 'answered'`,
      sql`NULLIF(${memories.sourceMetadata}->'kairosAsk'->>'answeredAt', '')::timestamptz >= ${start}`,
      sql`NULLIF(${memories.sourceMetadata}->'kairosAsk'->>'answeredAt', '')::timestamptz < ${end}`,
    ))
    .orderBy(sql`NULLIF(${memories.sourceMetadata}->'kairosAsk'->>'answeredAt', '')::timestamptz`)

  return rows.flatMap((row) => {
    const metadata = (row.sourceMetadata ?? {}) as Record<string, unknown>
    const kairosAsk = metadata.kairosAsk as Record<string, unknown> | undefined
    if (typeof kairosAsk?.answeredAt !== 'string') return []
    const answeredAt = new Date(kairosAsk.answeredAt)
    return Number.isNaN(answeredAt.getTime()) ? [] : [{ id: row.id, answeredAt }]
  })
}

export async function listKairosReflectionStaleness(userId: string): Promise<Array<{
  dominionId: string
  dominionName: string
  lastReflectedAt: Date | null
}>> {
  const rows = await db
    .select({
      dominionId: dominions.id,
      dominionName: dominions.name,
      lastReflectedAt: sql<Date | null>`MAX(${memories.createdAt})`,
    })
    .from(dominions)
    .leftJoin(memories, and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominions.id),
      eq(memories.streamClass, 'reflection'),
      isNull(memories.archivedAt),
    ))
    .where(and(
      eq(dominions.userId, userId),
      isNull(dominions.archivedAt),
    ))
    .groupBy(dominions.id, dominions.name)

  return rows
}

/** Return the newest kairos-ask memory (pending or answered) to find lastAskedAt. */
export async function getNewestKairosAsk(userId: string): Promise<{ id: string; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: memories.id, createdAt: memories.createdAt })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.type, 'advisory'),
        sql`${memories.sourceMetadata} ? 'kairosAsk'`,
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(1)

  return row ?? null
}

/** Return the last N aether payloads (including archived), newest first. */
export async function getPriorAethers(userId: string, limit = 5): Promise<Array<{ id: string; createdAt: Date; payload: AetherPayload | null }>> {
  const rows = await db
    .select({ id: memories.id, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.type, 'aether'),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(limit)

  return rows.map((r) => {
    const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      createdAt: r.createdAt,
      payload: (meta?.aether as AetherPayload) ?? null,
    }
  })
}

/** Return IDs of reflections created after a given timestamp. */
export async function getReflectionsSince(userId: string, since: Date): Promise<Array<{ id: string; dominionId: string | null; sourceMetadata: Record<string, unknown> }>> {
  // NOTE: Reflections do NOT store sourceMemoryIds in sourceMetadata by convention —
  // they are operator-authored text, not synthesised from specific memories.
  // As a result, addressedSourceIds will remain empty and the persistence check
  // falls back to a dominion-level approximation instead. This is a known
  // limitation of v1 (no-migration constraint). The field is returned so a
  // future schema extension can populate it without changing callers.
  const rows = await db
    .select({
      id: memories.id,
      dominionId: memories.dominionId,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'reflection'),
        isNull(memories.archivedAt),
        sql`${memories.createdAt} > ${since}`,
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(100)

  return rows.map((r) => ({
    id: r.id,
    dominionId: r.dominionId ?? null,
    sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>,
  }))
}

/** Create a pending kairos-ask memory. Returns the inserted row id. */
export async function createKairosAskMemory(
  userId: string,
  opts: {
    question: string
    dominionId: string | null
    aetherMemoryId: string
    sourceThoughtId: string | null
    sourceMemoryIds: string[]
    askedAt: string
    expiresAt?: string
    askMine?: KairosAskMineMeta
    externalId?: string
  },
): Promise<string> {
  if (opts.externalId) {
    const [existing] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.type, 'advisory'),
        sql`${memories.sourceMetadata}->>'externalId' = ${opts.externalId}`,
      ))
      .limit(1)
    if (existing) return existing.id
  }

  const kairosAsk: KairosAskMeta = {
    status: 'pending',
    aetherMemoryId: opts.aetherMemoryId,
    sourceThoughtId: opts.sourceThoughtId,
    sourceMemoryIds: opts.sourceMemoryIds,
    dominionId: opts.dominionId,
    askedAt: opts.askedAt,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  }

  const [row] = await db
    .insert(memories)
    .values({
      userId,
      dominionId: opts.dominionId,
      title: opts.question,
      bodyMd: opts.question,
      summary: opts.question,
      type: 'advisory',
      streamClass: 'advisory',
      source: 'system',
      sourceMetadata: {
        kairosAsk,
        kairosAskStatus: 'pending',
        ...(opts.askMine ? { askMine: opts.askMine } : {}),
        ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
        ...(opts.externalId ? { externalId: opts.externalId } : {}),
      },
      tags: ['kairos-ask'],
      pinned: false,
    })
    .returning({ id: memories.id })

  return row!.id
}

/**
 * Atomically claim a pending kairos-ask as answered and archive it. The
 * `kairosAskStatus = 'pending'` guard makes concurrent answers race-safe:
 * exactly one caller gets `true`, everyone else gets `false` and must not
 * keep their answer memory (warden wave-2 finding — the old read-modify-write
 * let two overlapping turns both mark and both keep a reflection).
 */
export async function markKairosAskAnswered(
  userId: string,
  questionMemoryId: string,
  answerMemoryId: string,
  answeredAt: string,
): Promise<boolean> {
  const patch = JSON.stringify({ status: 'answered', answeredAt, answerMemoryId })
  const claimed = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(
        jsonb_set(coalesce(${memories.sourceMetadata}, '{}'::jsonb), '{kairosAskStatus}', '"answered"'),
        '{kairosAsk}',
        coalesce(${memories.sourceMetadata}->'kairosAsk', '{}'::jsonb) || ${patch}::jsonb
      )`,
      archivedAt: new Date(answeredAt),
      updatedAt: new Date(),
    })
    .where(and(
      eq(memories.id, questionMemoryId),
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->>'kairosAskStatus' = 'pending'`,
    ))
    .returning({ id: memories.id })
  return claimed.length > 0
}

/** Archive a just-written answer memory that lost the claim race. */
export async function archiveOrphanAnswerMemory(userId: string, memoryId: string): Promise<void> {
  await db
    .update(memories)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
}
