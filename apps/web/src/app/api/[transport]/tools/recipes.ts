import { z } from 'zod'
import { listTraceHistory as _listTraceHistory } from '@/lib/data/recipes'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3B — trace-history MCP tool (recipe-run and cron traces).
// The on-demand run_recipe tool (and its REST mirror /api/v1/recipes/run)
// was retired with the BRIEF recipe, its only recipe: all of Kairos's
// thinking now runs on the Claude Max routine (docs/kairos/33).
//
// Lives outside the memories-parity lock set (memories-parity.test.ts), so
// new tools land here without disturbing the 7-tool count in tools/memories.ts.
// ─────────────────────────────────────────────────────────────────────────

export const registerRecipeTools: RegisterFn = (server) => {
  server.tool(
    'get_trace_history',
    'Return recent recipe-run traces (streamClass="trace") for the calling user. Optionally scope to a single Dominion or a specific recipe name. ' +
      'Use this to inspect recent recipe-run traces (e.g. SYNTHESIS_HEALTH) without scanning the full memory stream.',
    {
      dominionId: z.string().uuid().optional().describe('Scope to a single Dominion'),
      recipe: z.string().min(1).max(64).optional().describe('Filter to runs of one named recipe (matches sourceMetadata.recipe)'),
      limit: z.number().int().min(1).max(100).default(25).optional(),
    },
    { title: 'Get Trace History', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = traceHistoryQuery.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const rows = await _listTraceHistory(uid, parsed.data)
      return ok({ count: rows.length, traces: rows })
    },
  )
}

// Shared so the REST mirror parses identically. Lives in this file (not
// validators.ts) because it isn't a top-level brain entity — it's a query
// helper for the trace surface.
export const traceHistoryQuery = z.object({
  dominionId: z.string().uuid().optional(),
  recipe: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
})
