'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/actions/helpers'
import {
  confirmKairosDecisionByOwner,
  discardRelayedKairosDecision,
  listKairosDecisions,
  logKairosDecision,
  settleKairosDecisionByOwner,
  type DecisionResult,
} from '@/lib/data/kairos-decisions'
import {
  listDecisionsSchema,
  logDecisionSchema,
  ownerDecisionIdSchema,
  ownerDecisionVerdictSchema,
  type DecisionVerdict,
} from '@/lib/data/validators/kairos-decisions'
import type { KairosDecisionsList } from '@/lib/kairos/decisions/types'

// The owner's decision journal for the web session — the only path that logs
// as the owner, and with Telegram the only one that settles or confirms.

const PAGE = '/vorath/decisions'

export type DecisionActionResult =
  | { ok: true; list: KairosDecisionsList }
  | { ok: false; error: string }

const REFUSAL_MESSAGE: Record<Extract<DecisionResult, { ok: false }>['reason'], string> = {
  not_found: 'That decision is no longer open.',
  already_settled: 'That decision is already settled.',
  unconfirmed: 'Confirm this relayed decision first.',
  not_relayed: 'That decision is already yours.',
  past_check_by: 'Pick a check-by date from today on.',
  full: 'Too many open decisions — settle some first.',
  forbidden: 'Not allowed.',
  invalid_verdict: 'Pick right, wrong or void.',
}

async function finish(userId: string, res: DecisionResult): Promise<DecisionActionResult> {
  if (!res.ok) return { ok: false, error: REFUSAL_MESSAGE[res.reason] }
  revalidatePath(PAGE)
  return { ok: true, list: await listKairosDecisions(userId, { scope: 'all' }) }
}

export async function listOwnKairosDecisions(scope?: 'open' | 'all'): Promise<KairosDecisionsList> {
  const userId = await requireAuth()
  const input = listDecisionsSchema.parse({ scope })
  return listKairosDecisions(userId, input)
}

export async function logOwnKairosDecision(input: unknown): Promise<DecisionActionResult> {
  const userId = await requireAuth()
  const parsed = logDecisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid decision' }
  return finish(userId, await logKairosDecision(userId, parsed.data, { kind: 'owner', via: 'app' }))
}

export async function settleOwnKairosDecision(decisionId: string, verdict: DecisionVerdict): Promise<DecisionActionResult> {
  const userId = await requireAuth()
  const parsed = ownerDecisionVerdictSchema.safeParse({ decisionId, verdict })
  if (!parsed.success) return { ok: false, error: 'Pick right, wrong or void.' }
  return finish(userId, await settleKairosDecisionByOwner(userId, parsed.data.decisionId, parsed.data.verdict, { via: 'app' }))
}

export async function confirmOwnKairosDecision(decisionId: string): Promise<DecisionActionResult> {
  const userId = await requireAuth()
  const parsed = ownerDecisionIdSchema.safeParse({ decisionId })
  if (!parsed.success) return { ok: false, error: REFUSAL_MESSAGE.not_found }
  return finish(userId, await confirmKairosDecisionByOwner(userId, parsed.data.decisionId))
}

export async function discardOwnKairosDecision(decisionId: string): Promise<DecisionActionResult> {
  const userId = await requireAuth()
  const parsed = ownerDecisionIdSchema.safeParse({ decisionId })
  if (!parsed.success) return { ok: false, error: REFUSAL_MESSAGE.not_found }
  return finish(userId, await discardRelayedKairosDecision(userId, parsed.data.decisionId))
}
