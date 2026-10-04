import {
  acceptProposal,
  archiveMemory,
  findMemoryById,
  markKairosSpeaksReplied,
  type AcceptProposalResult,
  type MemoryWriteOptions,
} from '@/lib/data/memories'
import type { InboxResolution } from '@/lib/data/inbox'
import type { AcceptProposalInput } from '@/lib/data/validators/memory'
import { applyAcceptedConstitutionAmendment } from './constitution/amendment'
import { CONSTITUTION_PROPOSAL_KIND } from './constitution/schema'
import { IDEA_PROPOSAL_KIND, type IdeaOutcome } from './ideas/types'
import { decideKairosProposal, isDecidableProposalKind, type DecideProposalResult } from './proposal-decision'
import { reactOutcome, reactUsed } from './reactions'
import { recordIdeaOutcome } from '@/lib/data/ideas'
import type { Origin } from './origin'
import { runOnIdeaOutcome } from './thinking/handlers/idea-ext'
import { runOwnerDecisionHooks } from './moment'
import { recordToday, type TodayChannel } from './today'

// Proposal triage — the operator gate in propose-not-commit (docs/kairos/32 §2,
// docs/kairos/34 §2). Business orchestration over the pure lib/data writes:
//   - a constitution amendment is accepted by writing a new constitution
//     version (applyAcceptedConstitutionAmendment), never by the generic
//     promote — the returned memory is the new constitution row;
//   - every other proposal goes through lib/data acceptProposal and, on
//     success, gets the operator reactions (Usage + Outcome positive, each a
//     'feedback' op, then an immediate rescore). Reactions are best-effort and
//     run after the accept committed, so they never fail it.
// Every accept surface (inbox action, Telegram, MCP, REST) calls this.
//
// Idea-tournament survivors (sourceMetadata.kind 'idea', docs/kairos/35) also
// get their outcome stamped (recordIdeaOutcome) after the reactions, so the
// weekly review can learn from accepted vs dismissed ideas. Best-effort.

async function groundIdeaOutcome(userId: string, memoryId: string, outcome: IdeaOutcome): Promise<void> {
  try {
    await recordIdeaOutcome(userId, memoryId, outcome)
  } catch (err) {
    console.error('[kairos-inbox] failed to record idea outcome', err)
  }
}

// Wave 3 lane hooks on an idea outcome (bridge links, outcomeBy). Best-effort.
async function notifyIdeaOutcome(
  userId: string,
  memoryId: string,
  meta: Record<string, unknown>,
  outcome: IdeaOutcome,
  origin: Origin | undefined,
): Promise<void> {
  try {
    await runOnIdeaOutcome({ userId, memoryId, meta, outcome, origin })
  } catch (err) {
    console.error('[kairos-inbox] idea outcome hooks failed', err)
  }
}

// Wave 4 moment lanes after a successful accept/dismiss (the runner never throws).
async function notifyOwnerDecision(userId: string, memoryId: string, verdict: 'accept' | 'dismiss', meta: Record<string, unknown>): Promise<void> {
  await runOwnerDecisionHooks({ userId, memoryId, verdict, kairosSpeak: meta.kairosSpeak === true, kind: typeof meta.kind === 'string' ? meta.kind : null })
}

// Owner-decided kinds (Phase 2: goals) go through decideKairosProposal — the
// one decision function shared with Telegram's buttons — never the generic
// promote / archive. Agent origins are refused for those kinds.
function decisionToAccept(res: Extract<DecideProposalResult, { ok: false }>): AcceptProposalResult | null {
  if (res.reason === 'not_found') return null
  if (res.reason === 'not_decidable') return { ok: false, reason: 'not_a_proposal' }
  return { ok: false, reason: res.reason }
}

// Today log (spec_one_mind): one "decided" entry per triage. Owner-decided
// kinds are recorded once inside decideKairosProposal, never here.
const OWNER_ACCEPT: Origin = { kind: 'operator', via: 'accept' }
const OWNER_INBOX: Origin = { kind: 'operator', via: 'inbox' }

function todayChannelFor(origin: Origin): TodayChannel {
  if (origin.via === 'telegram') return 'telegram'
  if (origin.via === 'mcp') return 'mcp'
  return 'inbox'
}

async function recordDecisionToday(userId: string, memoryId: string, text: string, origin: Origin): Promise<void> {
  await recordToday(
    userId,
    { key: `inbox:${memoryId}`, channel: todayChannelFor(origin), type: 'decided', text, ref: { memoryId }, covered: 'memory' },
    origin,
  )
}

export interface AcceptKairosProposalOptions extends MemoryWriteOptions {
  // false: the caller records one aggregate entry itself (voice confirm).
  recordToday?: boolean
}

export async function acceptKairosProposal(
  memoryId: string,
  userId: string,
  input: AcceptProposalInput,
  options: AcceptKairosProposalOptions = {},
): Promise<AcceptProposalResult | null> {
  const { recordToday: shouldRecord = true, ...opts } = options
  const proposal = await findMemoryById(memoryId, userId)
  if (!proposal) return null

  const meta = (proposal.sourceMetadata ?? {}) as Record<string, unknown>
  if (isDecidableProposalKind(meta.kind)) {
    if (opts.origin && opts.origin.kind !== 'operator') return { ok: false, reason: 'forbidden_actor' }
    const res = await decideKairosProposal(userId, memoryId, {
      verdict: 'approve',
      via: opts.origin?.via === 'rest-session' ? 'rest-session' : 'inbox',
      ...(opts.origin ? { origin: opts.origin } : {}),
    })
    if (!res.ok) return decisionToAccept(res)
    await notifyOwnerDecision(userId, memoryId, 'accept', meta)
    const row = await findMemoryById(memoryId, userId)
    return row ? { ok: true, memory: row } : null
  }

  if (proposal.type === 'inbound' && meta.kind === CONSTITUTION_PROPOSAL_KIND) {
    const res = await applyAcceptedConstitutionAmendment(userId, memoryId)
    if (!res.ok) {
      if (res.reason === 'not_found') return null
      return { ok: false, reason: res.reason === 'stale_amendment' ? 'stale_amendment' : 'not_a_proposal' }
    }
    await notifyOwnerDecision(userId, memoryId, 'accept', meta)
    if (shouldRecord) {
      await recordDecisionToday(userId, memoryId, `Accepted constitution amendment: ${proposal.title}`, opts.origin ?? OWNER_ACCEPT)
    }
    const row = await findMemoryById(res.constitutionId, userId)
    return row ? { ok: true, memory: row } : null
  }

  // opts.origin: bearer surfaces (MCP, REST API key) pass agent so an
  // AI-client accept is not recorded as the operator's endorsement.
  const result = await acceptProposal(memoryId, userId, input, opts)
  if (result?.ok) {
    await reactOutcome(userId, memoryId, 'positive', 'proposal accepted')
    await reactUsed(userId, [memoryId], 'proposal accepted')
    // `meta` was read before the accept mutated the row.
    if (proposal.type === 'inbound' && meta.kind === IDEA_PROPOSAL_KIND) {
      await groundIdeaOutcome(userId, memoryId, 'accepted')
      await notifyIdeaOutcome(userId, memoryId, meta, 'accepted', opts.origin)
    }
    if (shouldRecord) await recordDecisionToday(userId, memoryId, `Accepted: ${proposal.title}`, opts.origin ?? OWNER_ACCEPT)
    await notifyOwnerDecision(userId, memoryId, 'accept', meta)
  }
  return result
}

// Shared inbox triage — the inbox server actions and the Telegram webhook
// resolve items through these, so the two surfaces can never drift.

export async function dismissInboxMemory(userId: string, memoryId: string): Promise<InboxResolution> {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory) return { ok: false, reason: 'not_found' }

  const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
  // An owner-decided kind: dismissing it is a veto through the one decision
  // function (its own reaction; repeat taps report already handled).
  if (isDecidableProposalKind(metadata.kind)) {
    const res = await decideKairosProposal(userId, memoryId, { verdict: 'veto', via: 'inbox' })
    if (res.ok) {
      await notifyOwnerDecision(userId, memoryId, 'dismiss', metadata)
      return { ok: true, id: memoryId }
    }
    return { ok: false, reason: res.reason === 'not_found' ? 'not_found' : 'already_resolved' }
  }
  if (memory.type !== 'inbound') return { ok: false, reason: 'not_found' }

  // Idempotent: Telegram delivers duplicate updates; a second dismiss must
  // report "already handled" instead of erroring.
  if (memory.archivedAt || metadata.status !== 'pending') return { ok: false, reason: 'already_resolved' }

  const archived = await archiveMemory(memoryId, userId)
  if (!archived) return { ok: false, reason: 'not_found' }
  // Dismissing a Kairos speak is an operator response: close pending speaks so
  // the reply gate clears (archiving alone leaves status 'pending'). Idempotent
  // with the Telegram path's own marker call; best-effort, never fails dismiss.
  if (metadata.kairosSpeak === true) {
    try {
      await markKairosSpeaksReplied(userId, new Date())
    } catch (err) {
      console.error('[kairos-inbox] failed to mark speaks replied', err)
    }
  } else {
    // Dismissing a proposal is an operator veto: Outcome negative + a
    // 'feedback' op (docs/kairos/32 §2). Best-effort, never fails dismiss.
    await reactOutcome(userId, memoryId, 'negative', 'proposal dismissed')
    if (metadata.kind === IDEA_PROPOSAL_KIND) {
      await groundIdeaOutcome(userId, memoryId, 'dismissed')
      await notifyIdeaOutcome(userId, memoryId, metadata, 'dismissed', OWNER_INBOX)
    }
  }
  await recordDecisionToday(userId, memoryId, `Dismissed: ${memory.title}`, OWNER_INBOX)
  await notifyOwnerDecision(userId, memoryId, 'dismiss', metadata)
  return { ok: true, id: archived.id }
}

export async function acceptInboxProposal(userId: string, memoryId: string): Promise<InboxResolution> {
  const result = await acceptKairosProposal(memoryId, userId, { pin: false })
  if (!result) return { ok: false, reason: 'not_found' }
  if (!result.ok) return { ok: false, reason: 'already_resolved' }
  return { ok: true, id: result.memory.id }
}
