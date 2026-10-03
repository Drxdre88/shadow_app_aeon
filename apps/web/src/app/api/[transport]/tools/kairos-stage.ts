import { readKairosStage, toKairosStageView } from '@/lib/data/kairos-stage'
import { getKairosStageSchema } from '@/lib/data/validators/kairos-stage'
import { renderStageBlock } from '@/lib/kairos/stage/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos stage — READ ONLY. What Kairos is attending to right now (the global
// workspace). Written only by the server-side selector after thinking jobs
// apply; no tool can post to it. Mirrors GET /api/v1/kairos/stage
// (kairos-stage-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosStageTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_stage',
    'What Kairos is attending to right now: the day\'s focus (if one ignited), the top coalitions of thought with their strength, and the recent hourly winners. format "json" (default) or "markdown" (the same ≤400-char block his thinking jobs see); pool "1" adds the whole pool. Read-only.',
    {
      format: getKairosStageSchema.shape.format.describe('"json" (default) or "markdown"'),
      pool: getKairosStageSchema.shape.pool.describe('"1" to include the whole pool (default "0")'),
    },
    { title: 'Get Kairos Stage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosStageSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const now = new Date()
      const state = await readKairosStage(uid)
      if (parsed.data.format === 'markdown') {
        const { block, cycle } = renderStageBlock(state, { now })
        return ok({ cycle, markdown: block })
      }
      return ok(toKairosStageView(state, { now, pool: parsed.data.pool === '1' }))
    }
  )
}
