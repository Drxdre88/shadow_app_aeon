import {
  findProposalForDecision,
  listExpiredTelegramProposals,
  markTelegramClosed,
  readDecision,
  readTelegramRef,
  recordProposalDecision,
  type ProposalDecisionVia,
  type ProposalVerdict,
} from '@/lib/data/proposal-decision'
import { casGoalUpdate, type GoalRecord } from '@/lib/data/goals'
import { casVoiceSampleStatus, expireVoiceSamples, VOICE_SAMPLE_KIND } from '@/lib/data/voice-samples'
import { londonDate } from '@/lib/kairos/daily-message-prompt'
import { GOAL_NOTE_MAX, GOAL_PROPOSAL_KIND } from './goals/parse'
import { approveGoal, expireStaleGoals, vetoGoal, type GoalActionFailure } from './goals/transitions'
import { writeCronFailureTrace } from './cron-trace'
import type { Origin } from './origin'
import { bookGoalCheckins } from './agenda/goal-checkins'
import { createKairosPromises } from './promises/create'
import { isVagueOutcome } from './promises/rules'
import { PROMISE_OUTCOME_MAX_CHARS, PROMISE_OUTCOME_MIN_CHARS } from '@/lib/data/validators/kairos-promises'
import { reactOutcome } from './reactions'
import { editMessageText, telegramConfigured } from './telegram'
import { recordToday } from './today'
import { cardTreeKind } from './card-tree/decision'
import { CARD_TREE_KIND } from './card-tree/types'
import { cardGardenKind } from './card-garden/decision'
import { CARD_GARDEN_KIND } from './card-garden/types'

// One decision function for every owner-decided proposal kind (Phase 2,
// Track C). Web inbox, Telegram buttons and the REST session all call
// decideKairosProposal; a kind registers its approve / veto effects here.
// Unregistered kinds answer 'not_decidable' and callers fall back to the old
// accept / dismiss. Agents (MCP, REST bearer) are refused for every kind.
//
// Claim-once: the kind's own transition is the claim (goals: a compare-and-
// set on goal.state under the goal lock), so a second tap, a Telegram
// redelivery or a web + Telegram race loses that compare-and-set and reports
// already_decided. The decision record (sourceMetadata.decision) is stamped
// after the effect, guarded on "none yet" — it never blocks the transition
// and is never written twice. A refused effect (cap_reached) records nothing,
// so the owner can decide again later.

export type ProposalDecisionFailure =
  | 'not_found'
  | 'already_decided'
  | 'expired'
  | 'not_decidable'
  | 'forbidden_actor'
  | 'cap_reached'

export interface DecideProposalInput {
  verdict: ProposalVerdict
  reason?: string | null
  // "Veto + why" on Telegram: the reason arrives in a later message.
  wantsReason?: boolean
  via: ProposalDecisionVia
  now?: Date
  // Bearer surfaces pass their agent origin; anything but operator is refused.
  origin?: Origin
}

export type DecideProposalResult =
  | { ok: true; verdict: ProposalVerdict; title: string; kind: string; memoryId: string }
  | { ok: false; reason: ProposalDecisionFailure; title?: string; decided?: ProposalVerdict }

type KindFailure = Exclude<ProposalDecisionFailure, 'not_decidable'>
export type KindOutcome = { ok: true } | { ok: false; reason: KindFailure; decided?: ProposalVerdict }

interface KindContext {
  userId: string
  id: string
  via: ProposalDecisionVia
  now: Date
}

export interface ProposalKindHandler {
  approve(ctx: KindContext): Promise<KindOutcome>
  veto(ctx: KindContext & { reason: string | null }): Promise<KindOutcome>
  // A "Veto + why" reason that arrived after the veto.
  onReason?(ctx: KindContext & { reason: string }): Promise<void>
  // Expiry sweep: unanswered proposals of this kind → expired (no reaction).
  expire(userId: string, now: Date): Promise<string[]>
}

export const REASON_MAX = 2000

// ── goal ───────────────────────────────────────────────────────────────────

function goalFailure(reason: GoalActionFailure): KindOutcome {
  if (reason === 'already_resolved') return { ok: false, reason: 'already_decided' }
  return { ok: false, reason }
}

// The approved goal's promise: "report back" by the goal's due date
// (owner_confirm — only the owner can say it was kept).
export function goalPromiseOutcome(goal: Pick<GoalRecord, 'title' | 'meta'>): string {
  const fits = (s: string) => s.length >= PROMISE_OUTCOME_MIN_CHARS && s.length <= PROMISE_OUTCOME_MAX_CHARS && !isVagueOutcome(s)
  const byQuestion = `Report back on: ${goal.meta.question.trim()}`
  if (fits(byQuestion)) return byQuestion
  return `Report back on: ${goal.title.trim()}`.slice(0, PROMISE_OUTCOME_MAX_CHARS)
}

async function createGoalPromise(userId: string, goal: GoalRecord, now: Date): Promise<void> {
  if (!goal.meta.dueAt) throw new Error('approved goal has no dueAt')
  const res = await createKairosPromises(
    userId,
    [{ outcome: goalPromiseOutcome(goal), dueDate: londonDate(new Date(goal.meta.dueAt)) }],
    { kind: 'goal', goalId: goal.id },
    now,
  )
  if (res.created.length === 0) {
    throw new Error(`goal promise not created: ${res.rejected.map((r) => r.reason).join(', ') || 'overflow'}`)
  }
}

const goalKind: ProposalKindHandler = {
  async approve({ userId, id, via, now }) {
    const res = await approveGoal(userId, id, { kind: 'operator', via }, {
      now,
      onApproved: (goal) => createGoalPromise(userId, goal, now),
    })
    if (!res.ok) return goalFailure(res.reason)
    if (res.onApprovedError) {
      console.error('[kairos:proposal-decision] goal approved but its promise failed:', res.onApprovedError)
      await writeCronFailureTrace(userId, { cronName: 'goal-promise', reason: 'promise_not_created', rawExcerpt: `${id}: ${res.onApprovedError}` }).catch(() => {})
    }
    // Horae check-ins (≤2) — their own try: a booking failure never touches
    // the approval or turns into onApprovedError.
    try {
      await bookGoalCheckins(userId, res.goal, now)
    } catch (err) {
      console.error('[kairos:proposal-decision] goal approved but its agenda check-ins failed:', err)
    }
    return { ok: true }
  },
  async veto({ userId, id, via, now, reason }) {
    const res = await vetoGoal(userId, id, { kind: 'operator', via }, { now, note: reason })
    return res.ok ? { ok: true } : goalFailure(res.reason)
  },
  async onReason({ userId, id, now, reason }) {
    await casGoalUpdate(userId, id, 'vetoed', { goal: { vetoNote: reason.slice(0, GOAL_NOTE_MAX) } }, now)
  },
  async expire(userId, now) {
    return (await expireStaleGoals(userId, now)).expired
  },
}

// ── voice_sample (character check) ─────────────────────────────────────────
// The claim is the pending → approved | vetoed compare-and-set on the row's
// own status. Deliberately NOT the generic accept: that would refile Kairos's
// text as an operator reflection (laundering his words as the owner's).

const casFailure: KindOutcome = { ok: false, reason: 'already_decided' }

const voiceSampleKind: ProposalKindHandler = {
  async approve({ userId, id, now }) {
    return (await casVoiceSampleStatus(userId, id, 'pending', 'approved', now)) ? { ok: true } : casFailure
  },
  async veto({ userId, id, now }) {
    return (await casVoiceSampleStatus(userId, id, 'pending', 'vetoed', now)) ? { ok: true } : casFailure
  },
  async expire(userId, now) {
    return expireVoiceSamples(userId, now)
  },
}

export const PROPOSAL_KINDS: Readonly<Record<string, ProposalKindHandler>> = {
  [GOAL_PROPOSAL_KIND]: goalKind,
  [VOICE_SAMPLE_KIND]: voiceSampleKind,
  [CARD_TREE_KIND]: cardTreeKind,
  [CARD_GARDEN_KIND]: cardGardenKind,
}

export function isDecidableProposalKind(kind: unknown): boolean {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(PROPOSAL_KINDS, kind)
}

// ── decide ─────────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<ProposalVerdict, string> = { approve: 'Approved', veto: 'Vetoed' }

export function verdictLabel(verdict: ProposalVerdict): string {
  return VERDICT_LABEL[verdict]
}

function cleanReason(reason: string | null | undefined): string | null {
  const t = reason?.trim()
  return t ? t.slice(0, REASON_MAX) : null
}

function isPastExpiry(meta: Record<string, unknown>, now: Date): boolean {
  if (meta.status !== 'pending' || typeof meta.expiresAt !== 'string') return false
  const at = Date.parse(meta.expiresAt)
  return Number.isFinite(at) && at <= now.getTime()
}

// A decision made outside Telegram strips the Telegram buttons so a later tap
// is not left looking live. Best-effort.
async function closeTelegramMessage(userId: string, id: string, meta: Record<string, unknown>, text: string, now: Date) {
  const ref = readTelegramRef(meta)
  if (!ref || meta.telegramClosedAt || !telegramConfigured()) return
  try {
    await editMessageText(ref.chatId, ref.messageId, text, { inlineKeyboard: [] })
    await markTelegramClosed(userId, id, now)
  } catch (err) {
    console.error('[kairos:proposal-decision] stripping the Telegram buttons failed', err)
  }
}

export async function decideKairosProposal(
  userId: string,
  id: string,
  input: DecideProposalInput,
): Promise<DecideProposalResult> {
  const now = input.now ?? new Date()
  const row = await findProposalForDecision(userId, id)
  if (!row) return { ok: false, reason: 'not_found' }
  const meta = row.sourceMetadata
  const kind = typeof meta.kind === 'string' ? meta.kind : ''
  const handler = isDecidableProposalKind(kind) ? PROPOSAL_KINDS[kind] : null
  if (!handler) return { ok: false, reason: 'not_decidable', title: row.title }
  if (input.origin && input.origin.kind !== 'operator') return { ok: false, reason: 'forbidden_actor', title: row.title }

  const prior = readDecision(meta)
  if (prior) return { ok: false, reason: 'already_decided', title: row.title, decided: prior.verdict }
  if (isPastExpiry(meta, now)) return { ok: false, reason: 'expired', title: row.title }

  const reason = input.verdict === 'veto' ? cleanReason(input.reason) : null
  const ctx: KindContext = { userId, id, via: input.via, now }
  const outcome = input.verdict === 'approve' ? await handler.approve(ctx) : await handler.veto({ ...ctx, reason })
  if (!outcome.ok) return { ok: false, reason: outcome.reason, title: row.title, ...(outcome.decided ? { decided: outcome.decided } : {}) }

  const awaitingReason = input.verdict === 'veto' && input.wantsReason === true && reason === null
  try {
    await recordProposalDecision(userId, id, {
      verdict: input.verdict,
      via: input.via,
      at: now.toISOString(),
      reason,
      awaitingReason,
    }, now)
  } catch (err) {
    // The transition committed; the record is audit + reason routing only.
    console.error('[kairos:proposal-decision] recording the decision failed', err)
  }

  // Reactions are best-effort (reactOutcome never throws), after the effect committed.
  await reactOutcome(userId, id, input.verdict === 'approve' ? 'positive' : 'negative', `proposal ${input.verdict === 'approve' ? 'approved' : 'vetoed'}`)

  if (input.via !== 'telegram') {
    await closeTelegramMessage(userId, id, meta, `${row.title}\n\n— ${VERDICT_LABEL[input.verdict]} in Aeon ✓`, now)
  }
  await recordDecisionToday(userId, id, row.title, input)
  return { ok: true, verdict: input.verdict, title: row.title, kind, memoryId: id }
}

// One "decided" entry per owner decision — reached only after the kind's
// claim-once transition won, so a repeat tap or redelivery records nothing.
async function recordDecisionToday(userId: string, id: string, title: string, input: DecideProposalInput): Promise<void> {
  const telegram = input.via === 'telegram'
  const reason = input.verdict === 'veto' ? cleanReason(input.reason) : null
  await recordToday(
    userId,
    {
      key: `decision:${id}`,
      channel: telegram ? 'telegram' : 'inbox',
      type: 'decided',
      text: `${VERDICT_LABEL[input.verdict]}: ${title}${reason ? ` — ${reason}` : ''}`,
      ref: { memoryId: id },
      covered: 'memory',
    },
    { kind: 'operator', via: telegram ? 'telegram' : 'inbox' },
  )
}

// "Veto + why": the reason (or a decline) was claimed — let the kind keep it.
export async function applyVetoReason(userId: string, id: string, kind: string | null, reason: string, now: Date): Promise<void> {
  const handler = kind && isDecidableProposalKind(kind) ? PROPOSAL_KINDS[kind] : null
  if (!handler?.onReason) return
  await handler.onReason({ userId, id, via: 'telegram', now, reason: reason.slice(0, REASON_MAX) })
}

// ── expiry sweep ───────────────────────────────────────────────────────────

export interface ProposalExpirySweepResult {
  expired: number
  telegramCleared: number
}

// Hourly: unanswered proposals expire (no answer = no action, no negative
// reaction) and their Telegram buttons are stripped — including proposals
// another path already expired. Idempotent.
export async function sweepExpiredProposals(userId: string, now: Date = new Date()): Promise<ProposalExpirySweepResult> {
  let expired = 0
  for (const handler of Object.values(PROPOSAL_KINDS)) {
    expired += (await handler.expire(userId, now)).length
  }
  let telegramCleared = 0
  if (telegramConfigured()) {
    for (const p of await listExpiredTelegramProposals(userId)) {
      try {
        await editMessageText(p.telegram.chatId, p.telegram.messageId, `${p.title}\n\n— Expired, no action`, { inlineKeyboard: [] })
      } catch (err) {
        // Deleted message / edit window closed: nothing left to strip.
        console.warn('[kairos:proposal-decision] expiring the Telegram message failed', err)
      }
      await markTelegramClosed(userId, p.id, now)
      telegramCleared++
    }
  }
  return { expired, telegramCleared }
}
