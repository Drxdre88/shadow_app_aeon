import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { proposeConstitutionAmendment } from '@/lib/kairos/constitution/amendment'
import { proposeConstitutionAmendmentSchema } from '@/lib/data/validators/constitution'

// Mirrors the propose_constitution_amendment MCP tool through the same
// validator + fn (constitution-parity.test.ts enforces this). Writes a pending
// proposal only — the constitution changes when the operator accepts it.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const parsed = proposeConstitutionAmendmentSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData(await proposeConstitutionAmendment(result.id, parsed.data, 'manual'), 201)
  }),
  API_WRITE_LIMIT
)
