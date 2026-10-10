'use server'

import { requireVorath } from '@/lib/actions/helpers'
import { listKairosAgenda, toKairosAgendaView } from '@/lib/data/kairos-agenda'
import { listKairosAgendaSchema, ownerAgendaItemIdSchema } from '@/lib/data/validators/kairos-agenda'
import { cancelAgendaItem } from '@/lib/kairos/agenda/cancel'

// Owner-only Horae controls for the web session. The Telegram operator chat
// ("cancel A3") is the other owner path; agents (MCP / REST bearer) can only
// read the agenda.

export async function listOwnKairosAgenda(scope?: 'open' | 'all') {
  const userId = await requireVorath()
  const input = listKairosAgendaSchema.parse({ scope })
  return (await listKairosAgenda(userId, input)).map(toKairosAgendaView)
}

export async function cancelOwnKairosAgendaItem(itemId: string) {
  const userId = await requireVorath()
  return cancelAgendaItem(userId, ownerAgendaItemIdSchema.parse(itemId), { kind: 'owner', via: 'session' })
}
