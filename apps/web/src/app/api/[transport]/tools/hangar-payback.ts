import { PaybackAccessError, readAgentPayback } from '@/lib/data/payback'
import { getAgentPaybackSchema } from '@/lib/data/validators/payback'
import { renderPaybackMarkdown } from '@/lib/kairos/payback/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Hangar payback ledger — READ ONLY. What the caller's card missions cost and
// how they ended; unknown cost stays unknown, runner deaths are their own bucket.
// Mirrors GET /api/v1/hangar/payback (hangar-payback-parity.test.ts).

export const registerHangarPaybackTools: RegisterFn = (server) => {
  server.tool(
    'get_agent_payback',
    'What your Hangar card missions cost and how they ended, over a period ("7d", "30d" default, "90d", "all"), optionally for one board (projectId). Totals: missions, finished, failed, stopped because the runner died (timed out or killed — counted separately from failures), still running/queued, known cost in USD, how many missions had no cost recorded (shown as unknown, never as zero), total running time and known cost per finished mission. Breakdowns by repo, engine and requested model (unset = "default"; groupBy limits to one) plus the 10 most expensive cards. Kairos chat/dialogue/today threads are excluded. format "json" (default) or "markdown". Read-only.',
    {
      period: getAgentPaybackSchema.shape.period.describe('"7d", "30d" (default), "90d" or "all"'),
      projectId: getAgentPaybackSchema.shape.projectId.describe('Optional board (project) id to limit the ledger to'),
      groupBy: getAgentPaybackSchema.shape.groupBy.describe('Optional: only this breakdown — "repo", "engine" or "model"'),
      format: getAgentPaybackSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Agent Payback', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getAgentPaybackSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const { period, projectId, groupBy } = parsed.data
      try {
        const view = await readAgentPayback(uid, { period, projectId, groupBy })
        if (parsed.data.format === 'markdown') return ok({ markdown: renderPaybackMarkdown(view) })
        return ok(view)
      } catch (err) {
        if (err instanceof PaybackAccessError) return fail(err.message)
        throw err
      }
    }
  )
}
