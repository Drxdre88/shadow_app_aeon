import { readKairosRapport, toKairosRapportView } from '@/lib/data/kairos-rapport'
import { getKairosRapportSchema } from '@/lib/data/validators/kairos-rapport'
import { rapportModes } from '@/lib/kairos/rapport/flag'
import { renderRapportMarkdown } from '@/lib/kairos/rapport/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos rapport — READ ONLY. Readiness per owner goal (change talk), small
// bids, and the rupture / repair state that times Kairos's unprompted
// messages. Written only server-side; no tool can change it.
// Mirrors GET /api/v1/kairos/rapport (kairos-rapport-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosRapportTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_rapport',
    'How Kairos reads the rapport with you: readiness per goal (preparing / committed / wavering, from your own wording), small bids it acknowledged, and whether it is backing off or owes a repair. format "json" (default) or "markdown". Read-only.',
    {
      format: getKairosRapportSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Kairos Rapport', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosRapportSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const now = new Date()
      const view = toKairosRapportView(await readKairosRapport(uid, now), { now, modes: rapportModes() })
      if (parsed.data.format === 'markdown') return ok({ markdown: renderRapportMarkdown(view) })
      return ok(view)
    }
  )
}
