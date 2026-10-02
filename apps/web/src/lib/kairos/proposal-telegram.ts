import {
  claimVetoReason,
  findReasonByUpdateId,
  listReasonPromptRows,
  setProposalTelegram,
  setReasonPrompt,
  type ReasonPromptRow,
} from '@/lib/data/proposal-decision'
import type { GoalRecord } from '@/lib/data/goals'
import { mightContainNumberedAnswers } from './ask-numbered'
import { renderGoalBody } from './goals/transitions'
import { applyVetoReason, decideKairosProposal, verdictLabel, type DecideProposalResult } from './proposal-decision'
import {
  answerCallbackQuery,
  editMessageText,
  sendKairosProposal,
  sendMessage,
  type ProposalCallbackAction,
} from './telegram'

// Telegram side of proposal decisions (Phase 2, Track C): announcing a
// proposal with Approve / Veto / Veto + why, handling the p1:* button taps,
// and routing the free-text "why" that follows a "Veto + why".

const REASON_REPLY_WINDOW_MS = 24 * 3_600_000
const REASON_LOOSE_WINDOW_MS = 30 * 60_000
const DECLINE_RE = /^(no reason|skip|none)[.!]*$/i

// ── announce ───────────────────────────────────────────────────────────────

// Operator only: Telegram is a single-operator channel, so another user's
// proposal must never land in the operator's chat. Best-effort for callers.
export async function announceGoalProposal(userId: string, goal: GoalRecord, now: Date = new Date()): Promise<boolean> {
  if (!userId || userId !== process.env.KAIROS_OPERATOR_USER_ID?.trim()) return false
  const sent = await sendKairosProposal({
    proposalId: goal.id,
    title: `Goal proposal: ${goal.title}`,
    body: renderGoalBody(goal.meta),
    expiresAt: goal.meta.expiresAt,
  })
  if (!sent) return false
  await setProposalTelegram(userId, goal.id, sent, now)
  return true
}

// ── button taps ────────────────────────────────────────────────────────────

export interface ProposalCallbackInput {
  callbackId: string
  action: ProposalCallbackAction
  proposalId: string
  chatId: number | string
  messageId: number | null
  originalText: string
}

function failureToast(result: Extract<DecideProposalResult, { ok: false }>): string {
  switch (result.reason) {
    case 'already_decided':
      return result.decided ? `Already decided: ${verdictLabel(result.decided)}` : 'Already decided'
    case 'expired':
      return 'Expired — no action'
    case 'cap_reached':
      return 'Two goals are already open — close one first'
    case 'forbidden_actor':
      return 'Not allowed'
    case 'not_decidable':
      return 'Unknown action'
    case 'not_found':
      return 'Not found'
  }
}

async function editQuietly(chatId: number | string, messageId: number, text: string) {
  try {
    await editMessageText(chatId, messageId, text, { inlineKeyboard: [] })
  } catch (err) {
    console.error('[kairos:proposal-telegram] editing the proposal message failed', err)
  }
}

export async function handleProposalCallback(
  userId: string,
  input: ProposalCallbackInput,
  now: Date = new Date(),
): Promise<DecideProposalResult> {
  const action = input.action.toLowerCase() as ProposalCallbackAction
  const result = await decideKairosProposal(userId, input.proposalId, {
    verdict: action === 'a' ? 'approve' : 'veto',
    wantsReason: action === 'w',
    via: 'telegram',
    now,
  })

  if (!result.ok) {
    await answerCallbackQuery(input.callbackId, failureToast(result))
    if (result.reason === 'expired' && input.messageId !== null) {
      await editQuietly(input.chatId, input.messageId, `${input.originalText}\n\n— Expired, no action`.trim())
    }
    return result
  }

  const label = verdictLabel(result.verdict)
  await answerCallbackQuery(input.callbackId, label)
  if (input.messageId !== null) {
    await editQuietly(input.chatId, input.messageId, `${input.originalText}\n\n— ${label} ✓`.trim())
  }

  if (action === 'w') {
    const prompt = await sendMessage(
      input.chatId,
      `Why the veto on '${result.title}'? Reply here, or 'no reason'.`,
      { replyMarkup: { force_reply: true, input_field_placeholder: 'Why the veto?' } },
    )
    await setReasonPrompt(userId, input.proposalId, { messageId: prompt.messageId, at: now })
  }
  return result
}

// ── "Veto + why" reply ─────────────────────────────────────────────────────

export interface VetoReasonMessage {
  text: string
  updateId: number | null
  replyToMessageId: number | null
}

function pickTarget(rows: ReasonPromptRow[], replyTo: number | null, now: Date): ReasonPromptRow | null {
  if (replyTo !== null) {
    // A reply to a prompt is about that proposal only — never re-aimed.
    const hit = rows.find((r) => r.decision.reasonPromptMessageId === replyTo)
    if (hit) return hit.decision.awaitingReason ? hit : null
  }
  const awaiting = rows.filter((r) => r.decision.awaitingReason)
  const looseCutoff = now.getTime() - REASON_LOOSE_WINDOW_MS
  const newest = awaiting[0]
  const at = newest?.decision.reasonPromptAt ? Date.parse(newest.decision.reasonPromptAt) : NaN
  return newest && Number.isFinite(at) && at >= looseCutoff ? newest : null
}

// True when the text was a veto reason (or a redelivery of one) — handled,
// acked once, and kept out of chat. A Q-label text is never a reason.
export async function routeVetoReason(
  userId: string,
  chatId: number | string,
  message: VetoReasonMessage,
  now: Date = new Date(),
): Promise<boolean> {
  const body = message.text.trim()
  if (!body || mightContainNumberedAnswers(body)) return false

  // Durable redelivery dedup: this update already supplied a reason.
  if (message.updateId !== null && await findReasonByUpdateId(userId, message.updateId)) return true

  const rows = await listReasonPromptRows(userId, new Date(now.getTime() - REASON_REPLY_WINDOW_MS))
  const target = pickTarget(rows, message.replyToMessageId, now)
  if (!target) return false

  const declined = DECLINE_RE.test(body)
  const reason = declined ? null : body
  const claimed = await claimVetoReason(userId, target.id, { reason, declined, updateId: message.updateId, now })
  // Lost the claim to a concurrent delivery: that one acks.
  if (!claimed) return true

  if (reason) {
    try {
      await applyVetoReason(userId, target.id, target.kind, reason, now)
    } catch (err) {
      console.error('[kairos:proposal-telegram] keeping the veto reason on the proposal failed', err)
    }
  }
  await sendMessage(chatId, declined ? `OK — no reason noted for '${target.title}'.` : `Noted — thanks. Kept with '${target.title}'.`)
  return true
}
