import { z } from 'zod'
import { listTraceHistory as _listTraceHistory } from '@/lib/data/recipes'
import { listRecipes } from '@/lib/kairos/recipes/registry'
import { runRecipe, RecipeNotFoundError } from '@/lib/kairos/dispatch'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3B/3C — recipe-surface MCP tools.
//
// Lives outside the memories-parity lock set (memories-parity.test.ts), so
// new tools land here without disturbing the 7-tool count in tools/memories.ts.
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

  server.tool(
    'list_recipes',
    'List every recipe registered in the Kairos catalogue (descriptor only: name, description, reads, writes). Use before run_recipe to discover what is available.',
    {},
    async (_args, extra) => {
      getUserId(extra)
      return ok({ recipes: listRecipes() })
    },
  )

  server.tool(
    'run_recipe',
    'Execute a named recipe for one Dominion. Runs through the dispatcher (canonical retrieval → flat/expanded → primary memory + trace). ' +
      'Returns { status: "created"|"existing", memoryId, traceId }. Idempotent on the recipe\'s primary externalId — re-firing returns "existing".',
    {
      name: z.string().min(1).max(64).describe('Recipe name (e.g. "BRIEF")'),
      dominionId: z.string().uuid().describe('Dominion to scope retrieval and writes to'),
      args: z.record(z.string(), z.unknown()).optional().describe('Optional recipe-specific arguments'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = runRecipeArgs.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      try {
        const result = await runRecipe(parsed.data.name, {
          userId: uid,
          dominionId: parsed.data.dominionId,
          args: parsed.data.args,
          surface: 'claude_code',
        })
        return ok(result)
      } catch (err) {
        if (err instanceof RecipeNotFoundError) return fail(err.message)
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )
}

// Shared so the REST mirror parses identically. Live in this file (not
// validators.ts) because they aren't top-level brain entities — they're
// query / dispatch helpers for the recipe surface.
export const traceHistoryQuery = z.object({
  dominionId: z.string().uuid().optional(),
  recipe: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
})

export const runRecipeArgs = z.object({
  name: z.string().min(1).max(64),
  dominionId: z.string().uuid(),
  args: z.record(z.string(), z.unknown()).optional(),
})
