'use server'

import { requireAuth, requireMemberAccess } from './helpers'
import { assertVorath } from '@/lib/vorath-access'
import { readAgentPayback, type PaybackView } from '@/lib/data/payback'
import { getAgentPaybackSchema, type PaybackGroup, type PaybackPeriod } from '@/lib/data/validators/payback'

/** Read-only Hangar payback ledger for the signed-in user, optionally limited to one board. */
export async function getAgentPayback(input: { period?: PaybackPeriod; projectId?: string; groupBy?: PaybackGroup } = {}): Promise<PaybackView> {
  const parsed = getAgentPaybackSchema.parse(input)
  const userId = parsed.projectId ? (await requireMemberAccess(parsed.projectId)).userId : await requireAuth()
  assertVorath(userId)
  return readAgentPayback(userId, { period: parsed.period, projectId: parsed.projectId, groupBy: parsed.groupBy })
}
