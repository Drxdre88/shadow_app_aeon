import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'

// Proposal decisions (Phase 2, Track C). Pure DB, no business rules. The
// decision record lives at sourceMetadata.decision; the kind's own transition
// (e.g. the goal compare-and-set) is the claim, and this record is stamped
// once afterwards (guarded on "no decision yet", so redeliveries and a web +
// Telegram double tap can never write a second one). "Veto + why" keeps
// decision.awaitingReason true until the owner's reply (or a decline) is
// claimed, also exactly once. No schema change: jsonb only.

export type ProposalVerdict = 'approve' | 'veto'
export type ProposalDecisionVia = 'telegram' | 'inbox' | 'rest-session'

export interface ProposalDecisionRecord {
  verdict: ProposalVerdict
  via: ProposalDecisionVia
  at: string
  reason: string | null
  awaitingReason: boolean
  reasonDeclined?: boolean
  reasonAt?: string
  reasonUpdateId?: number
  reasonPromptMessageId?: number
  reasonPromptAt?: string
}

export interface TelegramMessageRef {
  chatId: string | number
  messageId: number
}

export interface ProposalRow {
  id: string
  title: string
  type: string
  archivedAt: Date | null
  sourceMetadata: Record<string, unknown>
}

const decisionField = (key: string) => sql`${memories.sourceMetadata}->'decision'->>${key}`
const awaitingReason = sql`${decisionField('awaitingReason')} = 'true'`

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function readDecision(sourceMetadata: unknown): ProposalDecisionRecord | null {
  const d = asRecord(sourceMetadata).decision
  if (!d || typeof d !== 'object') return null
  const rec = d as Record<string, unknown>
  return rec.verdict === 'approve' || rec.verdict === 'veto' ? (rec as unknown as ProposalDecisionRecord) : null
}

export function readTelegramRef(sourceMetadata: unknown): TelegramMessageRef | null {
  const t = asRecord(asRecord(sourceMetadata).telegram)
  const chatOk = typeof t.chatId === 'string' || typeof t.chatId === 'number'
  return chatOk && typeof t.messageId === 'number' ? { chatId: t.chatId as string | number, messageId: t.messageId } : null
}

export async function findProposalForDecision(userId: string, id: string): Promise<ProposalRow | null> {
  const [row] = await db
    .select({
      id: memories.id,
      title: memories.title,
      type: memories.type,
      archivedAt: memories.archivedAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .limit(1)
  return row ? { ...row, sourceMetadata: asRecord(row.sourceMetadata) } : null
}

// Stamps sourceMetadata.decision once. False = a decision is already recorded
// (or the row is gone): the caller treats it as already decided.
export async function recordProposalDecision(
  userId: string,
  id: string,
  decision: ProposalDecisionRecord,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(coalesce(${memories.sourceMetadata}, '{}'::jsonb), '{decision}', ${JSON.stringify(decision)}::jsonb)`,
      updatedAt: now,
    })
    .where(and(
      eq(memories.id, id),
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->'decision' is null`,
    ))
    .returning({ id: memories.id })
  return rows.length > 0
}

// Remembers the force-reply prompt "Why the veto on …?" so a reply to it can
// be matched. Only while the reason is still awaited.
export async function setReasonPrompt(
  userId: string,
  id: string,
  prompt: { messageId: number; at: Date },
): Promise<boolean> {
  const patch = JSON.stringify({ reasonPromptMessageId: prompt.messageId, reasonPromptAt: prompt.at.toISOString() })
  const rows = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(${memories.sourceMetadata}, '{decision}', (${memories.sourceMetadata}->'decision') || ${patch}::jsonb)`,
      updatedAt: prompt.at,
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId), awaitingReason))
    .returning({ id: memories.id })
  return rows.length > 0
}

export interface ReasonPromptRow {
  id: string
  title: string
  kind: string | null
  decision: ProposalDecisionRecord
}

// Decisions whose reason prompt went out since `since` — the candidates a
// Telegram text can answer, and the update ids already claimed (durable
// redelivery dedup). Newest prompt first.
export async function listReasonPromptRows(userId: string, since: Date, limit = 20): Promise<ReasonPromptRow[]> {
  const promptAt = sql`(${decisionField('reasonPromptAt')})::timestamptz`
  const rows = await db
    .select({ id: memories.id, title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${decisionField('reasonPromptAt')} is not null`,
      sql`${promptAt} >= ${since.toISOString()}::timestamptz`,
    ))
    .orderBy(desc(promptAt))
    .limit(limit)
  return rows.flatMap((r) => {
    const decision = readDecision(r.sourceMetadata)
    if (!decision) return []
    const kind = asRecord(r.sourceMetadata).kind
    return [{ id: r.id, title: r.title, kind: typeof kind === 'string' ? kind : null, decision }]
  })
}

// True when this Telegram update already supplied (or declined) a reason.
export async function findReasonByUpdateId(userId: string, updateId: number): Promise<boolean> {
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), sql`${decisionField('reasonUpdateId')} = ${String(updateId)}`))
    .limit(1)
  return rows.length > 0
}

// Claims the awaited veto reason exactly once (awaitingReason true → false).
export async function claimVetoReason(
  userId: string,
  id: string,
  input: { reason: string | null; declined: boolean; updateId: number | null; now: Date },
): Promise<boolean> {
  const patch = JSON.stringify({
    awaitingReason: false,
    reason: input.reason,
    reasonDeclined: input.declined,
    reasonAt: input.now.toISOString(),
    ...(input.updateId !== null ? { reasonUpdateId: input.updateId } : {}),
  })
  const rows = await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(${memories.sourceMetadata}, '{decision}', (${memories.sourceMetadata}->'decision') || ${patch}::jsonb)`,
      updatedAt: input.now,
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId), awaitingReason))
    .returning({ id: memories.id })
  return rows.length > 0
}

// Where the proposal's Telegram message lives (top-level sourceMetadata.telegram;
// a goal row also mirrors it into goal.telegram).
export async function setProposalTelegram(userId: string, id: string, ref: TelegramMessageRef, now: Date): Promise<void> {
  const value = JSON.stringify({ chatId: ref.chatId, messageId: ref.messageId })
  await db
    .update(memories)
    .set({
      sourceMetadata: sql`case
        when jsonb_typeof(${memories.sourceMetadata}->'goal') = 'object'
          then jsonb_set(jsonb_set(${memories.sourceMetadata}, '{telegram}', ${value}::jsonb), '{goal,telegram}', ${value}::jsonb)
        else jsonb_set(coalesce(${memories.sourceMetadata}, '{}'::jsonb), '{telegram}', ${value}::jsonb)
      end`,
      updatedAt: now,
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
}

export interface OpenTelegramProposal {
  id: string
  title: string
  telegram: TelegramMessageRef
}

// Expired proposals whose Telegram buttons are still live (whichever path
// expired them: the hourly sweep or the nightly goal_propose plan).
export async function listExpiredTelegramProposals(userId: string, limit = 50): Promise<OpenTelegramProposal[]> {
  const rows = await db
    .select({ id: memories.id, title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->>'status' = 'expired'`,
      sql`jsonb_typeof(${memories.sourceMetadata}->'telegram') = 'object'`,
      sql`${memories.sourceMetadata}->'telegramClosedAt' is null`,
    ))
    .limit(limit)
  return rows.flatMap((r) => {
    const telegram = readTelegramRef(r.sourceMetadata)
    return telegram ? [{ id: r.id, title: r.title, telegram }] : []
  })
}

// The proposal's Telegram buttons were stripped; never edit it again.
export async function markTelegramClosed(userId: string, id: string, now: Date): Promise<void> {
  await db
    .update(memories)
    .set({
      sourceMetadata: sql`jsonb_set(${memories.sourceMetadata}, '{telegramClosedAt}', ${JSON.stringify(now.toISOString())}::jsonb)`,
      updatedAt: now,
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
}
