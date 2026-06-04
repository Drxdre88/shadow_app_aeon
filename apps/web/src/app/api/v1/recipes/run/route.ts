import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { runRecipe, RecipeNotFoundError } from '@/lib/kairos/dispatch'
import { runRecipeArgs } from '@/app/api/[transport]/tools/recipes'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — REST mirror of run_recipe MCP tool.
// Shares the runRecipeArgs validator and dispatch.runRecipe so MCP and
// REST surfaces never drift.
// ─────────────────────────────────────────────────────────────────────────

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid JSON body', 400)
    }

    const parsed = runRecipeArgs.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    try {
      const run = await runRecipe(parsed.data.name, {
        userId: result.id,
        dominionId: parsed.data.dominionId,
        args: parsed.data.args,
        surface: 'byok',
      })
      return jsonData(run)
    } catch (err) {
      if (err instanceof RecipeNotFoundError) return jsonError(err.message, 404)
      return jsonError(err instanceof Error ? err.message : String(err), 500)
    }
  }),
  API_WRITE_LIMIT,
)
