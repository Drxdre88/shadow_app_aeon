import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { getDominionFocus } from '@/lib/data/dominion-members'

// REST twin of the get_dominion_focus MCP tool (dominions-parity.test.ts):
// the caller's ranked live Dominions plus unattributed recent work. Read-only.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    return jsonData(await getDominionFocus(result.id))
  }),
  API_READ_LIMIT
)
