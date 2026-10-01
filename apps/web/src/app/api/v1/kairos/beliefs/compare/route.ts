import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { getLatestMindCompare } from '@/lib/data/beliefs'
import { getMindComparisonSchema } from '@/lib/data/validators/beliefs'

// Mirrors the get_mind_comparison MCP tool (beliefs-parity.test.ts): the
// latest weekly aligned-vs-own mind comparison, or null before the first run.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const parsed = getMindComparisonSchema.safeParse({})
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData({ comparison: await getLatestMindCompare(result.id) })
  }),
  API_READ_LIMIT
)
