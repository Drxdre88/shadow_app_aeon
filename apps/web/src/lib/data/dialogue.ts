import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, sessionEvents, memories } from '@/lib/db/schema'
import type { AetherPayload } from '@/lib/kairos/aether-types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Dialogue — data layer.
//
// A Dialogue is a multi-turn conversation between the operator and Kairos,
// seeded by a kairos-ask (or a free topic). It is the threaded successor to
// the one-shot answer_kairos_ask loop: instead of question → one flat
// reflection → archive, the question opens a thread that Kairos and the
// operator volley on, then commit_dialogue distills the whole exchange into
// durable reflections.
//
// No new schema: a Dialogue reuses the agent_sessions + session_events pair
// (engine='kairos-dialogue'), exactly as kairos-chat does. The difference is
// the seed metadata (the originating ask + Aether thought) lives on the
// session row, dominionId is allowed to be NULL (floating dialogues), and the
// turn roles are 'operator' | 'kairos'. All queries are userId-scoped.
// ─────────────────────────────────────────────────────────────────────────

export const DIALOGUE_ENGINE = 'kairos-dialogue' as const

export type DialogueRole = 'operator' | 'kairos'

/** Provenance of a dialogue — what Aether signal seeded it. Stored on agent_sessions.metadata. */
export interface DialogueSeedMeta {
  kind: 'kairos-dialogue'
  /** The pending kairos-ask this dialogue answers, or null for a free-standing topic. */
  kairosAskId: string | null
  /** The Aether memory the seed thought came from, for grounding. */
  aetherMemoryId: string | null
  /** The specific Aether thought id that seeded the question, if any. */
  sourceThoughtId: string | null
  /** Source memory ids behind the seed thought — Kairos's grounding substrate. */
  sourceMemoryIds: string[]
}

export interface DialogueTurn {
  id: string
  seq: number
  role: DialogueRole
  content: string
  citations: string[]
  createdAt: Date
}

export interface DialogueThread {
  id: string
  userId: string
  dominionId: string | null
  title: string
  status: string
  seed: DialogueSeedMeta
  createdAt: Date
}

function rowToSeed(metadata: unknown): DialogueSeedMeta {
  const m = (metadata ?? {}) as Record<string, unknown>
  return {
    kind: 'kairos-dialogue',
    kairosAskId: typeof m.kairosAskId === 'string' ? m.kairosAskId : null,
    aetherMemoryId: typeof m.aetherMemoryId === 'string' ? m.aetherMemoryId : null,
    sourceThoughtId: typeof m.sourceThoughtId === 'string' ? m.sourceThoughtId : null,
    sourceMemoryIds: Array.isArray(m.sourceMemoryIds)
      ? m.sourceMemoryIds.filter((x): x is string => typeof x === 'string')
      : [],
  }
}

/** Create a dialogue thread. Returns the new thread id. */
export async function createDialogue(
  userId: string,
  input: { dominionId: string | null; title: string; seed: DialogueSeedMeta },
): Promise<string> {
  const title = (input.title.trim() || 'Kairos dialogue').slice(0, 200)
  const [row] = await db
    .insert(agentSessions)
    .values({
      userId,
      dominionId: input.dominionId,
      engine: DIALOGUE_ENGINE,
      goal: title,
      prompt: '',
      status: 'running',
      metadata: { ...input.seed },
    })
    .returning({ id: agentSessions.id })
  return row!.id
}

/** Find an already-open dialogue for a given kairos-ask, so opening is idempotent. */
export async function findOpenDialogueForAsk(userId: string, kairosAskId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(and(
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, DIALOGUE_ENGINE),
      eq(agentSessions.status, 'running'),
      sql`${agentSessions.metadata}->>'kairosAskId' = ${kairosAskId}`,
    ))
    .orderBy(desc(agentSessions.spawnedAt))
    .limit(1)
  return row?.id ?? null
}

async function loadThreadRow(userId: string, threadId: string) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(
      eq(agentSessions.id, threadId),
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, DIALOGUE_ENGINE),
    ))
    .limit(1)
  return row ?? null
}

/** Load a dialogue thread plus all its turns, oldest first. Returns null if not found. */
export async function loadDialogue(
  userId: string,
  threadId: string,
): Promise<{ thread: DialogueThread; turns: DialogueTurn[] } | null> {
  const row = await loadThreadRow(userId, threadId)
  if (!row) return null

  const events = await db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, threadId), eq(sessionEvents.kind, 'message')))
    .orderBy(asc(sessionEvents.seq))

  const turns: DialogueTurn[] = events.map((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>
    return {
      id: e.id,
      seq: e.seq,
      role: p.role === 'kairos' ? 'kairos' : 'operator',
      content: typeof p.content === 'string' ? p.content : '',
      citations: Array.isArray(p.citations) ? p.citations.filter((c): c is string => typeof c === 'string') : [],
      createdAt: e.createdAt,
    }
  })

  return {
    thread: {
      id: row.id,
      userId: row.userId,
      dominionId: row.dominionId,
      title: row.goal,
      status: row.status,
      seed: rowToSeed(row.metadata),
      createdAt: row.spawnedAt,
    },
    turns,
  }
}

/**
 * Append one turn to a dialogue. seq is computed under a row-level lock on the
 * parent session so concurrent appends serialise (mirrors appendChatMessage).
 */
export async function appendDialogueTurn(
  userId: string,
  threadId: string,
  input: { role: DialogueRole; content: string; citations?: string[] },
): Promise<{ ok: true; turnId: string; seq: number } | { ok: false; reason: 'thread_not_found' }> {
  const row = await loadThreadRow(userId, threadId)
  if (!row) return { ok: false, reason: 'thread_not_found' }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${agentSessions} WHERE ${agentSessions.id} = ${threadId} FOR UPDATE`)

    const [last] = await tx
      .select({ seq: sessionEvents.seq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, threadId))
      .orderBy(desc(sessionEvents.seq))
      .limit(1)

    const nextSeq = (last?.seq ?? 0) + 1

    const [inserted] = await tx
      .insert(sessionEvents)
      .values({
        sessionId: threadId,
        seq: nextSeq,
        kind: 'message',
        payload: {
          role: input.role,
          content: input.content,
          ...(input.citations?.length ? { citations: input.citations } : {}),
        },
      })
      .returning({ id: sessionEvents.id })

    return { ok: true as const, turnId: inserted.id, seq: nextSeq }
  })
}

/** Close a dialogue thread (status='succeeded'). Returns whether a row was updated. */
export async function closeDialogue(userId: string, threadId: string): Promise<boolean> {
  const result = await db
    .update(agentSessions)
    .set({ status: 'succeeded', endedAt: new Date() })
    .where(and(
      eq(agentSessions.id, threadId),
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, DIALOGUE_ENGINE),
    ))
    .returning({ id: agentSessions.id })
  return result.length > 0
}

// ── Grounding helpers ─────────────────────────────────────────────────────

export interface SourceMemorySnapshot {
  id: string
  title: string
  body: string
  streamClass: string
  dominionId: string | null
}

/** Fetch a set of memories by id (user-scoped) for grounding a dialogue turn. */
export async function fetchMemoriesByIds(userId: string, ids: string[]): Promise<SourceMemorySnapshot[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      dominionId: memories.dominionId,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, ids)))

  // Preserve the caller's id order.
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      body: r.bodyMd ?? '',
      streamClass: r.streamClass,
      dominionId: r.dominionId,
    }))
}

/** Fetch the AetherPayload behind a stored Aether memory id, or null. */
export async function fetchAetherPayload(userId: string, memoryId: string): Promise<AetherPayload | null> {
  const [row] = await db
    .select({ sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId), eq(memories.type, 'aether')))
    .limit(1)
  if (!row) return null
  const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>
  return (meta.aether as AetherPayload) ?? null
}

/**
 * Write a floating (Dominion-less) reflection — the untethered path used when a
 * dialogue's distillation has no Dominion to anchor to. Mirrors the reflection
 * shape captureReflection produces for anchored writes.
 */
export async function writeFloatingReflection(
  userId: string,
  input: { bodyMd: string; title?: string | null; summary?: string | null; tags?: string[]; sourceMetadata?: Record<string, unknown> },
): Promise<string> {
  const firstLine = input.bodyMd.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const stripped = firstLine.replace(/^([#>*\-`]+\s*)+/, '').trim()
  const title = (input.title?.trim() || stripped.slice(0, 80) || 'Reflection').slice(0, 255)

  const [row] = await db
    .insert(memories)
    .values({
      userId,
      dominionId: null,
      title,
      bodyMd: input.bodyMd,
      summary: input.summary ?? null,
      type: 'reflection',
      streamClass: 'reflection',
      source: 'claude',
      sourceMetadata: { kairosReflect: true, ...(input.sourceMetadata ?? {}) },
      tags: input.tags ?? [],
      pinned: false,
    })
    .returning({ id: memories.id })
  return row!.id
}
