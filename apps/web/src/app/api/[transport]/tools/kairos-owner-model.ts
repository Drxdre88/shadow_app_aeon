import { readKairosOwnerModel, toKairosOwnerModelView } from '@/lib/data/kairos-owner-model'
import { getKairosOwnerModelSchema } from '@/lib/data/validators/kairos-owner-model'
import { renderOwnerModelMarkdown } from '@/lib/kairos/owner-model/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos owner model — READ ONLY. Kairos's working read of the owner: lasting
// traits, current states (which lapse ~10 days after he last re-confirmed
// them), unconfirmed trait candidates, the last weekly card and a correction
// tally. Only the owner corrects it (Telegram / web session); no tool can.
// Mirrors GET /api/v1/kairos/owner-model (kairos-owner-model-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosOwnerModelTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_owner_model',
    "Vorath's working read of the owner: lasting traits, current states with since/lapse dates (a state lapses unless he re-confirms it), unconfirmed trait candidates, expired and closed items, the last weekly \"what I think you're carrying\" card and a 30-day correction tally. format \"json\" (default) or \"markdown\". Read-only.",
    {
      format: getKairosOwnerModelSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Vorath Owner Model', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosOwnerModelSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const view = toKairosOwnerModelView(await readKairosOwnerModel(uid), { now: new Date() })
      if (parsed.data.format === 'markdown') return ok({ markdown: renderOwnerModelMarkdown(view) })
      return ok(view)
    }
  )
}
