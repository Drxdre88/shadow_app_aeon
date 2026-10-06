import { findGoal, type GoalRecord } from '@/lib/data/goals'
import { captureMemory } from '@/lib/data/memories'
import { renderGoalBody } from './goals/transitions'
import type { GateMode } from './moment/gate/flag'
import { gateLane } from './moment/lanes/gate'
import type { SpeakHold } from './moment/types'
import { goalProposalTitle, sendGoalProposal } from './proposal-telegram'
import type { SpeakInput } from './speak'

// Goal proposals through the Kairos gate (lane A), like every other unprompted
// speak. Observe logs the would-be decision and sends; on may hold the proposal
// as a held kairosSpeak row tagged with proposalId, which the gate release sends
// with its Approve / Veto buttons. A failing gate never swallows a proposal.

export const GOAL_PROPOSAL_HOLD_PREFIX = 'goal-proposal-hold:'

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200)

function speakInput(goal: GoalRecord): SpeakInput {
  return {
    title: goalProposalTitle(goal),
    message: renderGoalBody(goal.meta),
    kind: 'notify',
    urgency: 'normal',
    force: false,
    opsAlert: false,
    digest: false,
  }
}

async function gateHold(userId: string, input: SpeakInput, now: Date): Promise<SpeakHold | null> {
  try {
    const verdict = await gateLane.speakPolicy!({ userId, input, gate: false, awaitingReply: false, replyRate7d: 0, now })
    return verdict?.hold ?? null
  } catch (err) {
    console.warn('[kairos:proposal-gate] gate decision failed, sending now:', reason(err))
    return null
  }
}

async function holdProposal(userId: string, goal: GoalRecord, input: SpeakInput, hold: SpeakHold, now: Date): Promise<boolean> {
  try {
    await captureMemory(userId, {
      title: input.title,
      bodyMd: input.message,
      summary: input.message.slice(0, 1000),
      type: 'inbound',
      source: 'system',
      sourceMetadata: {
        kairosSpeak: true,
        status: 'held',
        kind: input.kind,
        urgency: input.urgency,
        externalId: `${GOAL_PROPOSAL_HOLD_PREFIX}${goal.id}`,
        proposalId: goal.id,
        gate: { heldAt: now.toISOString(), until: hold.until, reason: hold.reason },
      },
    })
    return true
  } catch (err) {
    console.error('[kairos:proposal-gate] holding the proposal failed, sending now:', reason(err))
    return false
  }
}

// Gate observe | on, operator already checked. Returns whether Telegram got it now.
export async function announceThroughGate(userId: string, goal: GoalRecord, now: Date, mode: Exclude<GateMode, 'off'>): Promise<boolean> {
  const input = speakInput(goal)
  const hold = await gateHold(userId, input, now)
  if (hold && mode === 'on' && await holdProposal(userId, goal, input, hold, now)) return false

  const sent = await sendGoalProposal(userId, goal, now)
  try {
    await gateLane.speakDelivered!({ userId, memoryId: goal.id, input, telegram: sent, now })
  } catch (err) {
    console.warn('[kairos:proposal-gate] decision log attach failed:', reason(err))
  }
  return sent
}

// Gate release of a held proposal row: only a still-open, unannounced proposal goes out. Never throws.
export async function releaseHeldGoalProposal(userId: string, proposalId: string, now: Date): Promise<boolean> {
  try {
    const goal = await findGoal(userId, proposalId)
    if (!goal || goal.meta.state !== 'proposed' || goal.meta.telegram) return false
    if (!(Date.parse(goal.meta.expiresAt) > now.getTime())) return false
    return await sendGoalProposal(userId, goal, now)
  } catch (err) {
    console.error('[kairos:proposal-gate] releasing the held proposal failed', proposalId, reason(err))
    return false
  }
}
