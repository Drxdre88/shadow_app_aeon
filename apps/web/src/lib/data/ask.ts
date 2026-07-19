import { db } from '@/lib/db'
import { dominions, memories } from '@/lib/db/schema'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
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

/** Mark a kairos-ask memory as answered and archive it. */
export async function markKairosAskAnswered(
  userId: string,
  questionMemoryId: string,
  answerMemoryId: string,
  answeredAt: string,
): Promise<void> {
  const [existing] = await db
    .select({ sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.id, questionMemoryId), eq(memories.userId, userId)))
    .limit(1)

  if (!existing) return

  const meta = (existing.sourceMetadata ?? {}) as Record<string, unknown>
  const prior = (meta.kairosAsk ?? {}) as Record<string, unknown>

  const updated: KairosAskMeta = {
    ...(prior as KairosAskMeta),
    status: 'answered',
    answeredAt,
    answerMemoryId,
  }

  await db
    .update(memories)
    .set({
      sourceMetadata: {
        ...meta,
        kairosAsk: updated,
        kairosAskStatus: 'answered',
      },
      archivedAt: new Date(answeredAt),
      updatedAt: new Date(),
    })
    .where(and(eq(memories.id, questionMemoryId), eq(memories.userId, userId)))
}
