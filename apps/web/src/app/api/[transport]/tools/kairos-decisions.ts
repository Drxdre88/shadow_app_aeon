import { listKairosDecisions, logKairosDecision } from '@/lib/data/kairos-decisions'
import { listDecisionsSchema, logDecisionSchema } from '@/lib/data/validators/kairos-decisions'
import { renderDecisionsMarkdown } from '@/lib/kairos/decisions/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// The owner's decision journal (P3-1). An agent may only relay a decision the
// owner stated himself and list the journal; a relayed entry waits for the
// owner to confirm it in the app and never counts until then. There is no
// settle tool: the owner settles in the app or on Telegram ("D3 right").
// Mirrors GET/POST /api/v1/kairos/decisions (kairos-decisions-parity.test.ts).

const LOG_SHAPE = logDecisionSchema.shape

export const registerKairosDecisionTools: RegisterFn = (server) => {
  server.tool(
    'log_decision',
    "Relay a big NON-TRADING decision the owner just stated himself (priorities, a hire, which project to back) into his decision journal. Never infer or invent one, and never log trading decisions. Gets a D-number and shows as 'relayed, confirm?' until the owner confirms it in the app; unconfirmed entries are excluded from his calibration. Cannot settle.",
    {
      decision: LOG_SHAPE.decision.describe('What the owner decided, in his words'),
      expectation: LOG_SHAPE.expectation.describe('What he expects to happen'),
      probability: LOG_SHAPE.probability.describe('How sure he is, 0.5–0.95 (e.g. 0.8 = 80%)'),
      decisionType: LOG_SHAPE.decisionType.describe('priority, hire, project, people, spend — or a short free-text type'),
      checkBy: LOG_SHAPE.checkBy.describe('Check-by date YYYY-MM-DD (today or later)'),
    },
    { title: 'Log Decision', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = logDecisionSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const res = await logKairosDecision(uid, parsed.data, { kind: 'relayed', via: 'mcp' })
      if (!res.ok) return fail(`Could not log the decision: ${res.reason}`)
      return ok({ decision: res.decision, note: 'Relayed — the owner confirms it in the app before it counts.' })
    }
  )

  server.tool(
    'list_decisions',
    "The owner's decision journal: open decisions (due first) with D-numbers, how sure he was and check-by dates, plus his calibration per decision type in plain words (shown once a type has 3 settled). scope 'open' (default) or 'all'; format 'json' (default) or 'markdown'. Read-only; separate from Vorath's predictions.",
    {
      scope: listDecisionsSchema.shape.scope.describe('"open" (default) or "all" (adds settled history)'),
      format: listDecisionsSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'List Decisions', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listDecisionsSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const list = await listKairosDecisions(uid, parsed.data)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderDecisionsMarkdown(list) })
      return ok({ count: list.decisions.length, ...list })
    }
  )
}
