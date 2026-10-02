'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/actions/helpers'
import { getKairosInbox } from '@/lib/data/inbox'
import { answerKairosAsk, dismissKairosAsk } from '@/lib/kairos/ask'
import { acceptInboxProposal, dismissInboxMemory } from '@/lib/kairos/proposal-accept'
import { decideKairosProposal } from '@/lib/kairos/proposal-decision'

const memoryIdSchema = z.string().uuid()
const answerSchema = z.string().trim().min(1).max(10_000)
const decideSchema = z.object({
  id: memoryIdSchema,
  verdict: z.enum(['approve', 'veto']),
  reason: z.string().trim().max(2000).optional(),
})

export type DecideKairosInboxProposalResult =
  | { ok: true; verdict: 'approve' | 'veto' }
  | { ok: false; reason: string }

// Approve / Veto / Veto + why from the web inbox. Owner-decided kinds (goals)
// go through the one decision function; any other proposal falls back to the
// classic accept / dismiss so the same buttons work everywhere.
export async function decideKairosInboxProposal(
  id: string,
  verdict: 'approve' | 'veto',
  reason?: string,
): Promise<DecideKairosInboxProposalResult> {
  const userId = await requireAuth()
  const parsed = decideSchema.safeParse({ id, verdict, reason })
  if (!parsed.success) return { ok: false, reason: 'invalid_input' }
  const input = parsed.data

  const res = await decideKairosProposal(userId, input.id, {
    verdict: input.verdict,
    reason: input.verdict === 'veto' ? input.reason || null : null,
    via: 'inbox',
  })
  if (res.ok) return { ok: true, verdict: res.verdict }
  if (res.reason !== 'not_decidable') return { ok: false, reason: res.reason }

  const fallback = input.verdict === 'approve'
    ? await acceptInboxProposal(userId, input.id)
    : await dismissInboxMemory(userId, input.id)
  return fallback.ok ? { ok: true, verdict: input.verdict } : { ok: false, reason: fallback.reason }
}

export async function listKairosInbox() {
  const userId = await requireAuth()
  return getKairosInbox(userId)
}

export async function answerKairosInboxAsk(questionMemoryId: string, answer: string) {
  const userId = await requireAuth()
  const result = await answerKairosAsk(
    userId,
    memoryIdSchema.parse(questionMemoryId),
    answerSchema.parse(answer),
    undefined,
    // The owner answering in their inbox (P2.5 origin).
    { kind: 'operator', via: 'ask' },
  )

  if ('error' in result) {
    throw new Error(result.error === 'not_found' ? 'Kairos question not found' : 'Dominion not found')
  }

  return result
}

// The owner's "skip": the question leaves the backlog without an answer and
// without a negative outcome.
export async function dismissKairosInboxAsk(questionMemoryId: string) {
  const userId = await requireAuth()
  const result = await dismissKairosAsk(userId, memoryIdSchema.parse(questionMemoryId))
  if ('error' in result) throw new Error('Kairos question not found')
  return { id: result.id }
}

export async function acceptKairosInboxProposal(memoryId: string) {
  const userId = await requireAuth()
  const result = await acceptInboxProposal(userId, memoryIdSchema.parse(memoryId))

  if (!result.ok) {
    throw new Error(result.reason === 'not_found' ? 'Proposal not found' : 'Memory is not a pending proposal')
  }
  return { id: result.id }
}

export async function dismissKairosInboxProposal(memoryId: string) {
  const userId = await requireAuth()
  const result = await dismissInboxMemory(userId, memoryIdSchema.parse(memoryId))

  if (!result.ok) throw new Error('Proposal not found')
  return { id: result.id }
}
