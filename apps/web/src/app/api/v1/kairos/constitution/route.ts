import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { getConstitutionOverview } from '@/lib/kairos/constitution/amendment'
import { getConstitutionSchema } from '@/lib/data/validators/constitution'

// Mirrors the get_constitution MCP tool through the same validator + fn
// (constitution-parity.test.ts enforces this). The live constitution, its
// version history, pending amendments and the latest drift reading.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const parsed = getConstitutionSchema.safeParse({})
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData(await getConstitutionOverview(result.id))
  }),
  API_READ_LIMIT
)
