import { readMorningCockpit } from '@/lib/data/morning-cockpit'
import { getMorningCockpitSchema } from '@/lib/data/validators/kairos-cockpit'
import { renderCockpitMarkdown } from '@/lib/kairos/cockpit/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Morning cockpit (P3-3) — READ ONLY. The clickable 06:00 view, assembled on
// every read: predictions due, open questions, promises, pending goal and
// card-plan proposals, stale cards, overnight agent sessions and repos with
// new lessons. Mirrors GET /api/v1/kairos/cockpit (kairos-cockpit-parity.test.ts).

export const registerKairosCockpitTools: RegisterFn = (server) => {
  server.tool(
    'get_morning_cockpit',
    "The owner's morning cockpit, assembled on read: predictions due (R-numbers), open Vorath questions (Q-numbers), open promises (P-numbers), goal and card-plan proposals waiting for a decision, stale board cards, agent sessions since 18:00 London yesterday (Vorath's own engines excluded) and repos whose lessons playbook changed overnight. Each section has a count and up to 8 rows with ids to act on. format \"json\" (default) or \"markdown\". Read-only.",
    {
      format: getMorningCockpitSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Morning Cockpit', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getMorningCockpitSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const cockpit = await readMorningCockpit(uid)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderCockpitMarkdown(cockpit) })
      return ok(cockpit)
    }
  )
}
