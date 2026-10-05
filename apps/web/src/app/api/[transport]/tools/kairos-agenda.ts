import { listKairosAgenda, toKairosAgendaView } from '@/lib/data/kairos-agenda'
import { listKairosAgendaSchema } from '@/lib/data/validators/kairos-agenda'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Horae (Kairos's agenda) — READ ONLY. Kairos books check-ins only through
// the server (goal approval, reflect follow-ups, one rebook); only the owner
// (web session or the operator Telegram chat) can cancel. No agent can book,
// fire or cancel an item. Mirrors GET /api/v1/kairos/agenda.
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosAgendaTools: RegisterFn = (server) => {
  server.tool(
    'list_kairos_agenda',
    'List Horae, Vorath\'s agenda of self-booked check-ins, by A-number (A2 …): what he will check, when it is due (London), status and what came of it. scope "open" (default) or "all" to include the closed history. Read-only — only the owner can cancel an item.',
    { scope: listKairosAgendaSchema.shape.scope.describe('"open" (default) or "all"') },
    { title: 'List Vorath Agenda (Horae)', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listKairosAgendaSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const items = (await listKairosAgenda(uid, parsed.data)).map(toKairosAgendaView)
      return ok({ count: items.length, items })
    }
  )
}
