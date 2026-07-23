import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, sessionEvents, dominions, userAiCredentials } from '@/lib/db/schema'
import { decodeDateOrNull } from './sql-decoders'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C1) — chat thread persistence.
//
// Reuses agent_sessions + session_events tables so Phase 1C doesn't add
// new schema. Mapping:
//   - One chat thread = one agent_sessions row with engine='kairos-chat'.
//     goal carries the thread title (the first user message, capped).
//     dominionId anchors the thread; status tracks 'running' (open) /
//     'succeeded' (archived). prompt is intentionally blank — chat
//     threads don't have a single fixed prompt the way spawn sessions do.
//   - One message = one session_events row with kind='message' and
//     payload={ role: 'user'|'assistant', content: string,
//     citations?: string[], model?: string }. seq is monotonic per
//     thread so the unique index on (sessionId, seq) keeps ordering
//     deterministic across concurrent writes.
//
// All queries are userId-scoped. agent_sessions has no implicit
// authorization layer — the chat actions must always pass the calling
// user's id and filter on it.
// ─────────────────────────────────────────────────────────────────────────

export const CHAT_ENGINE = 'kairos-chat' as const

export type ChatRole = 'user' | 'assistant'

import type { CitedMemorySnapshot, ChatRetrievalMeta } from './kairos-chat-payload'
import { parseRetrievalMeta, hasAnyRetrieval } from './kairos-chat-payload'

export interface ChatMessagePayload {
  role: ChatRole
  content: string
  citations?: string[]      // memory ids the model actually cited inline (subset of retrieval)
  retrieval?: ChatRetrievalMeta  // C2 — what was sent as grounding for this turn
  model?: string             // provider/model id, useful for audit
}

export interface ChatThreadSummary {
  id: string
  dominionId: string | null
  dominionName: string | null
  title: string
  status: string
  createdAt: Date
  lastMessageAt: Date | null
  messageCount: number
}

export interface ChatMessage {
  id: string
  threadId: string
  seq: number
  role: ChatRole
  content: string
  citations: string[]
  retrieval: ChatRetrievalMeta | null
  model: string | null
  createdAt: Date
}

export interface DailyChatThread {
  id: string
  dominionId: string | null
  title: string
  messages: ChatMessage[]
}

export async function createChatThread(
  userId: string,
  input: { dominionId: string | null; title?: string | null },
): Promise<{ ok: true; threadId: string } | { ok: false; reason: 'dominion_not_found' }> {
  // Ownership guard — an anchored thread's dominion must exist for this user.
  // Null dominion = unanchored whole-brain thread, no guard needed.
  if (input.dominionId) {
    const [dom] = await db
      .select({ id: dominions.id, name: dominions.name })
      .from(dominions)
      .where(and(eq(dominions.id, input.dominionId), eq(dominions.userId, userId)))
      .limit(1)
    if (!dom) return { ok: false, reason: 'dominion_not_found' }
  }

  const title = (input.title?.trim() || 'New conversation').slice(0, 200)

  const [row] = await db
    .insert(agentSessions)
    .values({
      userId,
      dominionId: input.dominionId,
      engine: CHAT_ENGINE,
      // goal stores the thread title — this is what surfaces in the
      // thread list UI. prompt is intentionally blank for chat threads.
      goal: title,
      prompt: '',
      status: 'running',
      metadata: {
        kind: 'chat-thread',
      },
    })
    .returning({ id: agentSessions.id })

  return { ok: true, threadId: row.id }
}

// Telegram bridge — the operator's persistent Telegram thread is found by a
// title convention (no schema change). Returns the newest still-open thread
// with that exact title, or null.
export async function findOpenChatThreadByTitle(userId: string, title: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(and(
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, CHAT_ENGINE),
      eq(agentSessions.goal, title),
      eq(agentSessions.status, 'running'),
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
      eq(agentSessions.engine, CHAT_ENGINE),
    ))
    .limit(1)
  return row ?? null
}

export async function listChatThreads(
  userId: string,
  opts: { dominionId?: string; limit?: number } = {},
): Promise<ChatThreadSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const scope = opts.dominionId
    ? and(
        eq(agentSessions.userId, userId),
        eq(agentSessions.engine, CHAT_ENGINE),
        eq(agentSessions.dominionId, opts.dominionId),
      )
    : and(
        eq(agentSessions.userId, userId),
        eq(agentSessions.engine, CHAT_ENGINE),
      )

  const rows = await db
    .select({
      id: agentSessions.id,
      dominionId: agentSessions.dominionId,
      dominionName: dominions.name,
      title: agentSessions.goal,
      status: agentSessions.status,
      createdAt: agentSessions.spawnedAt,
      lastMessageAt: sql`MAX(${sessionEvents.createdAt})`.mapWith(decodeDateOrNull),
      messageCount: sql<number>`COUNT(${sessionEvents.id})::int`,
    })
    .from(agentSessions)
    .leftJoin(dominions, eq(agentSessions.dominionId, dominions.id))
    .leftJoin(sessionEvents, and(
      eq(sessionEvents.sessionId, agentSessions.id),
      eq(sessionEvents.kind, 'message'),
    ))
    .where(scope)
    .groupBy(agentSessions.id, dominions.name)
    .orderBy(desc(sql`COALESCE(MAX(${sessionEvents.createdAt}), ${agentSessions.spawnedAt})`))
    .limit(limit)

  return rows
}

export async function listChatThreadsWithMessagesOn(
  userId: string,
  start: Date,
  end: Date,
  messageLimit = 80,
): Promise<DailyChatThread[]> {
  const cap = Math.min(Math.max(messageLimit, 1), 100)
  const scope = and(
    eq(agentSessions.userId, userId),
    eq(agentSessions.engine, CHAT_ENGINE),
    eq(sessionEvents.kind, 'message'),
    gte(sessionEvents.createdAt, start),
    lt(sessionEvents.createdAt, end),
  )

  const threads = await db
    .select({
      id: agentSessions.id,
      dominionId: agentSessions.dominionId,
      title: agentSessions.goal,
    })
    .from(agentSessions)
    .innerJoin(sessionEvents, eq(sessionEvents.sessionId, agentSessions.id))
    .where(scope)
    .groupBy(agentSessions.id)
    .orderBy(asc(agentSessions.spawnedAt))

  return Promise.all(threads.map(async (thread) => {
    const events = await db
      .select({
        id: sessionEvents.id,
        seq: sessionEvents.seq,
        payload: sessionEvents.payload,
        createdAt: sessionEvents.createdAt,
      })
      .from(sessionEvents)
      .where(and(
        eq(sessionEvents.sessionId, thread.id),
        eq(sessionEvents.kind, 'message'),
        gte(sessionEvents.createdAt, start),
        lt(sessionEvents.createdAt, end),
      ))
      .orderBy(desc(sessionEvents.seq))
      .limit(cap)

    const messages = events.reverse().flatMap((event): ChatMessage[] => {
      const payload = (event.payload ?? {}) as Partial<ChatMessagePayload>
      if ((payload.role !== 'user' && payload.role !== 'assistant') || typeof payload.content !== 'string') {
        return []
      }
      return [{
        id: event.id,
        threadId: thread.id,
        seq: event.seq,
        role: payload.role,
        content: payload.content,
        citations: Array.isArray(payload.citations)
          ? payload.citations.filter((citation): citation is string => typeof citation === 'string')
          : [],
        retrieval: parseRetrievalMeta(payload.retrieval),
        model: typeof payload.model === 'string' ? payload.model : null,
        createdAt: event.createdAt,
      }]
    })

    return { ...thread, messages }
  }))
}

export async function listChatDistillEligibleUserIds(): Promise<string[]> {
  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  if (usersWithDominions.length === 0) return []

  const credentialed = await db
    .selectDistinct({ userId: userAiCredentials.userId })
    .from(userAiCredentials)
    .where(and(
      isNull(userAiCredentials.revokedAt),
      inArray(userAiCredentials.userId, usersWithDominions.map((row) => row.userId)),
    ))

  return credentialed.map((row) => row.userId)
}

export async function getChatThread(
  userId: string,
  threadId: string,
): Promise<{ thread: ChatThreadSummary; messages: ChatMessage[] } | null> {
  const row = await loadThreadRow(userId, threadId)
  if (!row) return null

  const [dom] = row.dominionId
    ? await db.select({ name: dominions.name }).from(dominions).where(eq(dominions.id, row.dominionId)).limit(1)
    : [null]

  const events = await db
    .select()
    .from(sessionEvents)
    .where(and(
      eq(sessionEvents.sessionId, threadId),
      eq(sessionEvents.kind, 'message'),
    ))
    .orderBy(asc(sessionEvents.seq))

  const messages: ChatMessage[] = events.map((e) => {
    const payload = (e.payload ?? {}) as Partial<ChatMessagePayload>
    return {
      id: e.id,
      threadId,
      seq: e.seq,
      role: (payload.role === 'assistant' ? 'assistant' : 'user'),
      content: typeof payload.content === 'string' ? payload.content : '',
      citations: Array.isArray(payload.citations) ? payload.citations.filter((c): c is string => typeof c === 'string') : [],
      retrieval: parseRetrievalMeta(payload.retrieval),
      model: typeof payload.model === 'string' ? payload.model : null,
      createdAt: e.createdAt,
    }
  })

  return {
    thread: {
      id: row.id,
      dominionId: row.dominionId,
      dominionName: dom?.name ?? null,
      title: row.goal,
      status: row.status,
      createdAt: row.spawnedAt,
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : null,
      messageCount: messages.length,
    },
    messages,
  }
}

export async function appendChatMessage(
  userId: string,
  threadId: string,
  payload: ChatMessagePayload,
): Promise<{ ok: true; messageId: string; seq: number } | { ok: false; reason: 'thread_not_found' }> {
  const row = await loadThreadRow(userId, threadId)
  if (!row) return { ok: false, reason: 'thread_not_found' }

  // Postgres default isolation (READ COMMITTED) lets two concurrent
  // appends both see the same MAX(seq) and race on the unique
  // (sessionId, seq) index — one would error visibly to the user even
  // though nothing corrupts. Take a row-level lock on the parent
  // agent_sessions row first so seq compute serialises per thread.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT 1 FROM ${agentSessions} WHERE ${agentSessions.id} = ${threadId} FOR UPDATE`,
    )

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
          role: payload.role,
          content: payload.content,
          ...(payload.citations?.length ? { citations: payload.citations } : {}),
          ...(payload.retrieval && hasAnyRetrieval(payload.retrieval) ? { retrieval: payload.retrieval } : {}),
          ...(payload.model ? { model: payload.model } : {}),
        },
      })
      .returning({ id: sessionEvents.id })

    return { ok: true as const, messageId: inserted.id, seq: nextSeq }
  })
}

// Used by the orphan-retry path: when the user re-sends with an edited
// body after a prior AI failure, replace the orphan's content in place
// instead of double-posting. User-scoped via the parent thread row.
export async function updateChatMessageContent(
  userId: string,
  threadId: string,
  seq: number,
  newContent: string,
): Promise<{ ok: true } | { ok: false; reason: 'thread_not_found' | 'message_not_found' }> {
  const row = await loadThreadRow(userId, threadId)
  if (!row) return { ok: false, reason: 'thread_not_found' }

  const [existing] = await db
    .select({ id: sessionEvents.id, payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, threadId), eq(sessionEvents.seq, seq)))
    .limit(1)
  if (!existing) return { ok: false, reason: 'message_not_found' }

  const payload = (existing.payload ?? {}) as Partial<ChatMessagePayload>
  await db
    .update(sessionEvents)
    .set({ payload: { ...payload, content: newContent } })
    .where(eq(sessionEvents.id, existing.id))

  return { ok: true }
}

export async function archiveChatThread(
  userId: string,
  threadId: string,
): Promise<boolean> {
  const result = await db
    .update(agentSessions)
    .set({ status: 'succeeded', endedAt: new Date() })
    .where(and(
      eq(agentSessions.id, threadId),
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, CHAT_ENGINE),
    ))
    .returning({ id: agentSessions.id })
  return result.length > 0
}
