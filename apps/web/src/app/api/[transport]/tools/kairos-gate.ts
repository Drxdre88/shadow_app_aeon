import { listHeldSpeaks, readKairosGate, toKairosGateView } from '@/lib/data/kairos-gate'
import { getKairosGateSchema } from '@/lib/data/validators/kairos-gate'
import { renderGateMarkdown } from '@/lib/kairos/moment/gate/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos gate — READ ONLY. Whether Kairos is holding unprompted messages for
// a natural break, what is held right now, his recent hold/send/release
// decisions and the learned receptivity map (reply rate, latency and warmth
// by London hour, weekday, kind, source and break). Timing only; written by
// the server alone. Mirrors GET /api/v1/kairos/gate (kairos-gate-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosGateTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_gate',
    'Kairos gate: the gate and receptivity modes and limits, unprompted messages held for a natural break (title, held at, reason, deadline), recent hold/send/release decisions, and the receptivity map (reply rate, latency, warmth by London hour, weekday, kind, source, break type; reply channels). format "json" (default) or "markdown". Read-only.',
    {
      format: getKairosGateSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Kairos Gate', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosGateSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const [state, held] = await Promise.all([readKairosGate(uid), listHeldSpeaks(uid)])
      const view = toKairosGateView(state, held)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderGateMarkdown(view) })
      return ok(view)
    }
  )
}
