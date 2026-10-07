import { findGoal } from '@/lib/data/goals'
import { captureMemory } from '@/lib/data/memories'
import { findProposalForDecision } from '@/lib/data/proposal-decision'
import { CARD_GARDEN_KIND } from './card-garden/types'
import { CARD_TREE_KIND } from './card-tree/types'
import type { GateMode } from './moment/gate/flag'
import { gateLane } from './moment/lanes/gate'
import type { SpeakHold } from './moment/types'
import { GOAL_PROPOSAL_HOLD_PREFIX, sendGoalProposal, sendProposal, type AnnouncedProposal } from './proposal-telegram'
import type { SpeakInput } from './speak'

// Owner-decided proposals (goals, card trees) through the Kairos gate (lane A),
// like every other unprompted speak. Observe logs the would-be decision and
// sends; on may hold the proposal as a held kairosSpeak row tagged with
// proposalId, which the gate release sends with its Approve / Veto buttons.
// A failing gate never swallows a proposal.

export { GOAL_PROPOSAL_HOLD_PREFIX }

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200)

function speakInput(proposal: AnnouncedProposal): SpeakInput {
  return {
    title: proposal.title,
    message: proposal.body,
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

async function holdProposal(userId: string, proposal: AnnouncedProposal, input: SpeakInput, hold: SpeakHold, now: Date): Promise<boolean> {
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
        externalId: `${proposal.holdPrefix}${proposal.id}`,
        proposalId: proposal.id,
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
export async function announceThroughGate(userId: string, proposal: AnnouncedProposal, now: Date, mode: Exclude<GateMode, 'off'>): Promise<boolean> {
  const input = speakInput(proposal)
  const hold = await gateHold(userId, input, now)
  if (hold && mode === 'on' && await holdProposal(userId, proposal, input, hold, now)) return false

  const sent = await sendProposal(userId, proposal, now)
  try {
    await gateLane.speakDelivered!({ userId, memoryId: proposal.id, input, telegram: sent, now })
  } catch (err) {
    console.warn('[kairos:proposal-gate] decision log attach failed:', reason(err))
  }
  return sent
}

type HeldRelease = (userId: string, proposalId: string, now: Date) => Promise<boolean>

// Non-goal proposal kinds, by the kind stored on the proposal row.
const HELD_RELEASE: Readonly<Record<string, () => Promise<HeldRelease>>> = {
  [CARD_TREE_KIND]: async () => (await import('./card-tree/announce')).releaseHeldCardTree,
  [CARD_GARDEN_KIND]: async () => (await import('./card-garden/announce')).releaseHeldCardGarden,
}

async function releaseByStoredKind(userId: string, proposalId: string, now: Date): Promise<boolean> {
  const row = await findProposalForDecision(userId, proposalId)
  const kind = typeof row?.sourceMetadata.kind === 'string' ? row.sourceMetadata.kind : ''
  if (!Object.prototype.hasOwnProperty.call(HELD_RELEASE, kind)) return false
  const release = await HELD_RELEASE[kind]()
  return await release(userId, proposalId, now)
}

// Gate release of a held proposal row: only a still-open, unannounced
// proposal goes out (a goal, else dispatched by its stored kind). Never throws.
export async function releaseHeldGoalProposal(userId: string, proposalId: string, now: Date): Promise<boolean> {
  try {
    const goal = await findGoal(userId, proposalId)
    if (!goal) return await releaseByStoredKind(userId, proposalId, now)
    if (goal.meta.state !== 'proposed' || goal.meta.telegram) return false
    if (!(Date.parse(goal.meta.expiresAt) > now.getTime())) return false
    return await sendGoalProposal(userId, goal, now)
  } catch (err) {
    console.error('[kairos:proposal-gate] releasing the held proposal failed', proposalId, reason(err))
    return false
  }
}