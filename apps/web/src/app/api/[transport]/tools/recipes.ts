import { z } from 'zod'
import { listTraceHistory as _listTraceHistory } from '@/lib/data/recipes'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3B — recipe-surface MCP tools.
//
// Currently exposes one tool: get_trace_history. Phase 3C adds list_recipes
// and run_recipe here once the dispatcher lands.
// ─────────────────────────────────────────────────────────────────────────

export const registerRecipeTools: RegisterFn = (server) => {
  server.tool(
    'get_trace_history',
    'Return recent recipe-run traces (streamClass="trace") for the calling user. Optionally scope to a single Dominion or a specific recipe name. ' +
      'Lieutenants (Oracle, Cartographer) and the operator use this to inspect what BRIEF / WEAVE / etc. produced over the last N runs without scanning the full memory stream.',
    {
      dominionId: z.string().uuid().optional().describe('Scope to a single Dominion'),
      recipe: z.string().min(1).max(64).optional().describe('Filter to runs of one named recipe (matches sourceMetadata.recipe)'),
      limit: z.number().int().min(1).max(100).default(25).optional(),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = traceHistoryQuery.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const rows = await _listTraceHistory(uid, parsed.data)
      return ok({ count: rows.length, traces: rows })
    },
  )
}

// Same shape as the MCP tool's inline declaration; shared so the REST
// mirror parses identically. Lives in this file (not validators.ts)
// because get_trace_history isn't a top-level brain entity — it's a
// query helper for the recipe surface.
export const traceHistoryQuery = z.object({
  dominionId: z.string().uuid().optional(),
  recipe: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
})
