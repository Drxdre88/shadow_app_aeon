import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, sessionEvents } from '@/lib/db/schema'
import { DIALOGUE_ENGINE } from './dialogue'
import type { ChatMessage, DailyChatThread } from './kairos-chat'

// ─────────────────────────────────────────────────────────────────────────
// Dialogue threads for the nightly chat-distill (spec_one_mind, behind
// KAIROS_DISTILL_DIALOGUES). Same shape as listChatThreadsWithMessagesOn so
// the distill loop treats them alike; turns map operator → 'user',
// kairos → 'assistant'. The `engine` marker lets the distill cap origin: an
// operator turn in a dialogue is relayed by an agent (Triad), not typed by
// the owner on an owner-authenticated surface.
// ─────────────────────────────────────────────────────────────────────────

export { DIALOGUE_ENGINE }
export type DistillDialogueThread = DailyChatThread & { engine: typeof DIALOGUE_ENGINE }

export async function listDialogueThreadsWithTurnsOn(
  userId: string,
  start: Date,
  end: Date,
  turnLimit = 80,
): Promise<DistillDialogueThread[]> {
  const cap = Math.min(Math.max(turnLimit, 1), 100)
  const threads = await db
    .select({ id: agentSessions.id, dominionId: agentSessions.dominionId, title: agentSessions.goal })
    .from(agentSessions)
    .innerJoin(sessionEvents, eq(sessionEvents.sessionId, agentSessions.id))
    .where(and(
      eq(agentSessions.userId, userId),
      eq(agentSessions.engine, DIALOGUE_ENGINE),
      eq(sessionEvents.kind, 'message'),
      gte(sessionEvents.createdAt, start),
      lt(sessionEvents.createdAt, end),
    ))
    .groupBy(agentSessions.id)
    .orderBy(asc(agentSessions.spawnedAt))

  return Promise.all(threads.map(async (thread) => {
    const events = await db
      .select({ id: sessionEvents.id, seq: sessionEvents.seq, payload: sessionEvents.payload, createdAt: sessionEvents.createdAt })
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
      const p = (event.payload ?? {}) as Record<string, unknown>
      if ((p.role !== 'operator' && p.role !== 'kairos') || typeof p.content !== 'string') return []
      return [{
        id: event.id,
        threadId: thread.id,
        seq: event.seq,
        role: p.role === 'operator' ? 'user' : 'assistant',
        content: p.content,
        citations: Array.isArray(p.citations) ? p.citations.filter((c): c is string => typeof c === 'string') : [],
        retrieval: null,
        model: null,
        createdAt: event.createdAt,
      }]
    })
    return { ...thread, engine: DIALOGUE_ENGINE, messages }
  }))
}
