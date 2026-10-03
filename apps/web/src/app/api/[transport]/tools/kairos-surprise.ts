import { readKairosSurprise, toKairosSurpriseView } from '@/lib/data/kairos-surprise'
import { getKairosSurpriseSchema } from '@/lib/data/validators/kairos-surprise'
import { renderSurpriseMarkdown } from '@/lib/kairos/surprise/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos surprise — READ ONLY. What surprised Kairos lately (wrong or right
// predictions, kept or lapsed promises, owner corrections, lost support,
// contradictions, ahas), the learning-progress areas and the replay set.
// Written only by server-side producers; no tool can record an event.
// Mirrors GET /api/v1/kairos/surprise (kairos-surprise-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosSurpriseTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_surprise',
    'What surprised Kairos lately: the newest surprise events (kind, strength 0–1, how many beliefs each touched and opened for re-thinking), a 7-day tally, learning progress per area and the latest replay set. format "json" (default) or "markdown". Read-only.',
    {
      format: getKairosSurpriseSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Kairos Surprise', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosSurpriseSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const view = toKairosSurpriseView(await readKairosSurprise(uid), { now: new Date() })
      if (parsed.data.format === 'markdown') return ok({ markdown: renderSurpriseMarkdown(view) })
      return ok(view)
    }
  )
}
