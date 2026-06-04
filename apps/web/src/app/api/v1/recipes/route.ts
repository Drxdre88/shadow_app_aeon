import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listRecipes } from '@/lib/kairos/recipes/registry'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — REST mirror of list_recipes MCP tool.
// ─────────────────────────────────────────────────────────────────────────

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    return jsonData({ recipes: listRecipes() })
  }),
  API_READ_LIMIT,
)
