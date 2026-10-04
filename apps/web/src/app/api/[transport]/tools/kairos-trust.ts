import { readKairosTrust } from '@/lib/data/kairos-trust'
import { getKairosTrustSchema } from '@/lib/data/validators/kairos-trust'
import { renderTrustMarkdown } from '@/lib/kairos/trust/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Kairos earned trust per area — READ ONLY. Recomputed on every read from
// settled predictions, goals the owner took and goal-linked promises; never
// stored and never fed to a Kairos prompt.
// Mirrors GET /api/v1/kairos/trust (kairos-trust-parity.test.ts).

export const registerKairosTrustTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_trust',
    'How far to trust Kairos in each area (Dominion or prediction topic), from the last 90 days: settled calls with calibration, plans the owner kept that Kairos doubted and who was right, goals taken / landed / missed (vetoes shown, not scored), goal promises kept, and a level (too early / check me / second opinion / lean on me) with a one-line statement. Ideas and recent corrections are shown for context only. format "json" (default) or "markdown"; optional area (Dominion name, topic label or key). Read-only.',
    {
      format: getKairosTrustSchema.shape.format.describe('"json" (default) or "markdown"'),
      area: getKairosTrustSchema.shape.area.describe('Optional Dominion name, topic label (e.g. "delivery & timing") or area key'),
    },
    { title: 'Get Kairos Trust', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosTrustSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const view = await readKairosTrust(uid, { area: parsed.data.area })
      if (parsed.data.format === 'markdown') return ok({ markdown: renderTrustMarkdown(view) })
      return ok(view)
    }
  )
}
