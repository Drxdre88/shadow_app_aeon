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
import { reactOutcome, reactUsed } from './reactions'

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

export async function acceptKairosProposal(
  memoryId: string,
  userId: string,
  input: AcceptProposalInput,
  opts: MemoryWriteOptions = {},
): Promise<AcceptProposalResult | null> {
  const proposal = await findMemoryById(memoryId, userId)
  if (!proposal) return null

  const meta = (proposal.sourceMetadata ?? {}) as Record<string, unknown>
  if (proposal.type === 'inbound' && meta.kind === CONSTITUTION_PROPOSAL_KIND) {
    const res = await applyAcceptedConstitutionAmendment(userId, memoryId)
    if (!res.ok) {
      if (res.reason === 'not_found') return null
      return { ok: false, reason: res.reason === 'stale_amendment' ? 'stale_amendment' : 'not_a_proposal' }
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
  }
  return result
}

// Shared inbox triage — the inbox server actions and the Telegram webhook
// resolve items through these, so the two surfaces can never drift.

export async function dismissInboxMemory(userId: string, memoryId: string): Promise<InboxResolution> {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory || memory.type !== 'inbound') return { ok: false, reason: 'not_found' }

  const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
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
  }
  return { ok: true, id: archived.id }
}

export async function acceptInboxProposal(userId: string, memoryId: string): Promise<InboxResolution> {
  const result = await acceptKairosProposal(memoryId, userId, { pin: false })
  if (!result) return { ok: false, reason: 'not_found' }
  if (!result.ok) return { ok: false, reason: 'already_resolved' }
  return { ok: true, id: result.memory.id }
}
