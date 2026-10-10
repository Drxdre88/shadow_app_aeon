import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { updateDominion } from '@/lib/data/dominions'
import { updateDominionSchema } from '@/lib/data/validators'

// REST twin of the update_dominion MCP tool (dominions-parity.test.ts): same
// validator, same data function, scoped to the caller's own Dominions.

type Params = { params: Promise<{ id: string }> }

const dominionIdSchema = z.string().uuid()

export const PATCH = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied
    const { id } = await (ctx as Params).params
    if (!dominionIdSchema.safeParse(id).success) return jsonError('Dominion not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const parsed = updateDominionSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const row = await updateDominion(id, result.id, parsed.data)
    if (!row) return jsonError('Dominion not found', 404)
    return jsonData(row)
  }),
  API_WRITE_LIMIT
)
