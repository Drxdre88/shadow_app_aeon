import { z } from 'zod'
import { mutateKairosAgenda } from '@/lib/data/kairos-agenda'
import type { KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import { closeAgendaInState } from './rules'

// The owner's cancel for a Horae item — web session (server action) or the
// operator Telegram chat ("cancel A3"). A fired item still waiting on its
// agenda_due job can be cancelled too: the job's apply re-reads the item and
// writes nothing once it is no longer fired. No agent, MCP tool, REST bearer
// path or thinking handler may import this module (kairos-agenda-guard.test.ts).

export interface AgendaOwner { kind: 'owner'; via: 'session' | 'telegram' }

const ownerSchema = z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']) }).strict()

export type CancelAgendaResult =
  | { ok: true; item: KairosAgendaItem }
  | { ok: false; reason: 'not_found' | 'already_closed' | 'forbidden_canceller' }

export async function cancelAgendaItem(
  userId: string,
  itemId: string,
  by: AgendaOwner,
  now: Date = new Date(),
): Promise<CancelAgendaResult> {
  const owner = ownerSchema.safeParse(by)
  if (!owner.success) return { ok: false, reason: 'forbidden_canceller' }
  return mutateKairosAgenda<CancelAgendaResult>(userId, (state) => {
    const next = closeAgendaInState(state, itemId, { status: 'cancelled', cancelledBy: owner.data }, now)
    if (!next) {
      const closed = state.closed.some((i) => i.id === itemId)
      return { state: null, result: { ok: false, reason: closed ? 'already_closed' : 'not_found' } }
    }
    return { state: next.state, result: { ok: true, item: next.item } }
  })
}
