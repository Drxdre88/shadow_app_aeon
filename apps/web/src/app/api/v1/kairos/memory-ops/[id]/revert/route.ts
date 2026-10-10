import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'
import { revertMemoryOpSchema } from '@/lib/data/validators/memory-ops'

// Mirrors the revert_memory_op MCP tool through the same validator + fn
// (memory-ops-parity.test.ts enforces this). The operator's veto of an engine change.

type Params = { params: Promise<{ id: string }> }

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied
    const { id } = await (ctx as Params).params

    const parsed = revertMemoryOpSchema.safeParse({ opId: id })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const res = await revertMemoryOp(result.id, parsed.data.opId, { reason: 'operator veto (REST)' })
    if (!res.ok) {
      if (res.reason === 'not_found') return jsonError('Memory op not found', 404)
      return jsonError(`Cannot revert: ${res.reason}`, 409)
    }
    return jsonData(res)
  }),
  API_WRITE_LIMIT
)
