import { db } from '@/lib/db'
import { agentSessions, memories, sessionEvents } from '@/lib/db/schema'
import { CHAT_ENGINE } from '@/lib/data/kairos-chat'
import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm'

export const AWAIT_WINDOW_HOURS = 48

const REPLY_RATE_DAYS = 7
const REPLY_CREDIT_HOURS = 24
const REPLIED_STATUSES = new Set(['replied', 'answered', 'dismissed', 'accepted'])

type SourceMetadata = Record<string, unknown>

function statusFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const status = (metadata as SourceMetadata).status
  return typeof status === 'string' ? status : null
}

function hasReplyStatus(metadata: unknown): boolean {
  const status = statusFrom(metadata)
  return status !== null && REPLIED_STATUSES.has(status)
}

// The initiative engine needs one shared view of whether Kairos still has the
// operator's attention. Archived speaks remain part of that conversation:
// dismissing an interrupt resolves it, but must never make it disappear from
// cadence decisions or allow a second message to stack behind it.
export async function getConversationState(userId: string) {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - REPLY_RATE_DAYS * 24 * 60 * 60 * 1000)

  const [lastOutboundRow] = await db
    .select({
      id: memories.id,
      title: memories.title,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      eq(memories.source, 'system'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)

  const recentOutbounds = await db
    .select({
      id: memories.id,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      eq(memories.source, 'system'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      gte(memories.createdAt, sevenDaysAgo),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(100)

  let replied = false
  if (lastOutboundRow) {
    replied = hasReplyStatus(lastOutboundRow.sourceMetadata)
    if (!replied) {
      const [chatReply] = await db
        .select({ createdAt: sessionEvents.createdAt })
        .from(sessionEvents)
        .innerJoin(agentSessions, eq(sessionEvents.sessionId, agentSessions.id))
        .where(and(
          eq(agentSessions.userId, userId),
          eq(agentSessions.engine, CHAT_ENGINE),
          eq(sessionEvents.kind, 'message'),
          sql`${sessionEvents.payload}->>'role' = 'user'`,
          gt(sessionEvents.createdAt, lastOutboundRow.createdAt),
        ))
        .orderBy(desc(sessionEvents.createdAt))
        .limit(1)
      replied = Boolean(chatReply)
    }
  }

  let repliedWithin24h = recentOutbounds.filter((outbound) => (
    hasReplyStatus(outbound.sourceMetadata)
  )).length

  if (recentOutbounds.length > repliedWithin24h) {
    const oldestOutboundAt = recentOutbounds.at(-1)!.createdAt
    const newestReplyDeadline = new Date(
      recentOutbounds[0].createdAt.getTime() + REPLY_CREDIT_HOURS * 60 * 60 * 1000,
    )
    const chatTurns = await db
      .select({ createdAt: sessionEvents.createdAt })
      .from(sessionEvents)
      .innerJoin(agentSessions, eq(sessionEvents.sessionId, agentSessions.id))
      .where(and(
        eq(agentSessions.userId, userId),
        eq(agentSessions.engine, CHAT_ENGINE),
        eq(sessionEvents.kind, 'message'),
        sql`${sessionEvents.payload}->>'role' = 'user'`,
        gt(sessionEvents.createdAt, oldestOutboundAt),
        lte(sessionEvents.createdAt, newestReplyDeadline),
      ))

    repliedWithin24h += recentOutbounds.filter((outbound) => {
      if (hasReplyStatus(outbound.sourceMetadata)) return false
      const replyDeadline = outbound.createdAt.getTime() + REPLY_CREDIT_HOURS * 60 * 60 * 1000
      return chatTurns.some((turn) => {
        const repliedAt = turn.createdAt.getTime()
        return repliedAt > outbound.createdAt.getTime() && repliedAt <= replyDeadline
      })
    }).length
  }

  const status = lastOutboundRow ? statusFrom(lastOutboundRow.sourceMetadata) : null
  const lastOutbound = lastOutboundRow
    ? {
        id: lastOutboundRow.id,
        title: lastOutboundRow.title,
        createdAt: lastOutboundRow.createdAt,
        status,
      }
    : null
  const awaitingReply = Boolean(
    lastOutbound
      && !replied
      && now.getTime() - lastOutbound.createdAt.getTime() < AWAIT_WINDOW_HOURS * 60 * 60 * 1000,
  )

  return {
    lastOutbound,
    replied,
    awaitingReply,
    replyRate7d: recentOutbounds.length === 0 ? 0 : repliedWithin24h / recentOutbounds.length,
  }
}
