import { db } from '@/lib/db'
import { agentSessions, memories, sessionEvents } from '@/lib/db/schema'
import { CHAT_ENGINE } from '@/lib/data/kairos-chat'
import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm'

export const AWAIT_WINDOW_HOURS = 48

const REPLY_RATE_DAYS = 7
export const REPLY_CREDIT_HOURS = 24
export const REPLIED_STATUSES: ReadonlySet<string> = new Set(['replied', 'answered', 'dismissed', 'accepted'])

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

// A gate-held speak (KAIROS_GATE) has not been sent yet; once released, it was
// sent at gate.releasedAt, not at capture. Rows never held keep createdAt.
export function isHeldSpeak(metadata: unknown): boolean {
  return statusFrom(metadata) === 'held'
}

export function speakSentAt(outbound: { createdAt: Date; sourceMetadata: unknown }): Date {
  const meta = outbound.sourceMetadata
  const gate = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as SourceMetadata).gate : null
  const raw = gate && typeof gate === 'object' ? (gate as SourceMetadata).releasedAt : null
  const released = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
  return Number.isFinite(released) ? new Date(released) : outbound.createdAt
}

// Status-credit only counts toward the reply RATE when the reply landed inside
// the credit window; a 40h-late reply still resolves the conversation but must
// not bump cadence. Rows resolved without a repliedAt stamp (inbox actions)
// carry no timing evidence, so they earn no rate credit either.
export function repliedWithinCredit(outbound: { createdAt: Date; sourceMetadata: unknown }): boolean {
  if (!hasReplyStatus(outbound.sourceMetadata)) return false
  const raw = (outbound.sourceMetadata as SourceMetadata).repliedAt
  if (typeof raw !== 'string') return false
  const repliedAt = Date.parse(raw)
  if (Number.isNaN(repliedAt)) return false
  return repliedAt - speakSentAt(outbound).getTime() <= REPLY_CREDIT_HOURS * 60 * 60 * 1000
}

// The initiative engine needs one shared view of whether Kairos still has the
// operator's attention. Archived speaks remain part of that conversation:
// dismissing an interrupt resolves it, but must never make it disappear from
// cadence decisions or allow a second message to stack behind it.
export async function getConversationState(userId: string) {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - REPLY_RATE_DAYS * 24 * 60 * 60 * 1000)

  // Only a question expects an answer, so only a question may arm the reply
  // gate. Notifies, ops alerts and the Evening Digest (all kind:'notify') are
  // one-way registers: letting them arm awaitingReply blocked the tick and
  // ask-mine for 48h after every routine notify (research/kairos_2909 A3).
  // The kind predicate subsumes the old opsAlert/digest exclusions here; the
  // cadence query below keeps them because it counts every conversational send.
  // Held rows are not sent yet; of the newest few, the latest SEND wins.
  const questionRows = await db
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
      sql`${memories.sourceMetadata}->>'kind' = 'question'`,
      sql`(${memories.sourceMetadata}->>'status') IS DISTINCT FROM 'held'`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(5)
  const lastOutboundRow = questionRows
    .filter((row) => !isHeldSpeak(row.sourceMetadata))
    .map((row) => ({ ...row, sentAt: speakSentAt(row) }))
    .reduce<(typeof questionRows[number] & { sentAt: Date }) | undefined>(
      (best, row) => (!best || row.sentAt.getTime() > best.sentAt.getTime() ? row : best),
      undefined,
    )

  // Held rows get no reply credit and no place in the rate until released.
  const recentOutbounds = (await db
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
      sql`(${memories.sourceMetadata}->>'opsAlert') IS DISTINCT FROM 'true'`,
      sql`(${memories.sourceMetadata}->>'digest') IS DISTINCT FROM 'true'`,
      gte(memories.createdAt, sevenDaysAgo),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(100))
    .filter((row) => !isHeldSpeak(row.sourceMetadata))
    .map((row) => ({ ...row, sentAt: speakSentAt(row) }))

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
          gt(sessionEvents.createdAt, lastOutboundRow.sentAt),
        ))
        .orderBy(desc(sessionEvents.createdAt))
        .limit(1)
      replied = Boolean(chatReply)
    }
  }

  let repliedWithin24h = recentOutbounds.filter(repliedWithinCredit).length

  if (recentOutbounds.length > repliedWithin24h) {
    const sentTimes = recentOutbounds.map((outbound) => outbound.sentAt.getTime())
    const oldestOutboundAt = new Date(Math.min(...sentTimes))
    const newestReplyDeadline = new Date(Math.max(...sentTimes) + REPLY_CREDIT_HOURS * 60 * 60 * 1000)
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
      if (repliedWithinCredit(outbound)) return false
      const replyDeadline = outbound.sentAt.getTime() + REPLY_CREDIT_HOURS * 60 * 60 * 1000
      return chatTurns.some((turn) => {
        const repliedAt = turn.createdAt.getTime()
        return repliedAt > outbound.sentAt.getTime() && repliedAt <= replyDeadline
      })
    }).length
  }

  const status = lastOutboundRow ? statusFrom(lastOutboundRow.sourceMetadata) : null
  // createdAt here is the send time (release time for a gate-released row).
  const lastOutbound = lastOutboundRow
    ? {
        id: lastOutboundRow.id,
        title: lastOutboundRow.title,
        createdAt: lastOutboundRow.sentAt,
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
