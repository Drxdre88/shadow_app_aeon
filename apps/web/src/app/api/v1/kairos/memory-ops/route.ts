import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listMemoryOps } from '@/lib/data/memory-ops'
import { listMemoryOpsSchema } from '@/lib/data/validators/memory-ops'

// Mirrors the list_memory_ops MCP tool through the same validator + data fn
// (memory-ops-parity.test.ts enforces this). Memory engine change log, newest first.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const params = request.nextUrl.searchParams
    const parsed = listMemoryOpsSchema.safeParse({
      memoryId: params.get('memoryId') ?? undefined,
      op: params.get('op') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const { memoryId, op, limit } = parsed.data
    const rows = await listMemoryOps(result.id, { memoryId, ops: op ? [op] : undefined, limit })
    return jsonData({ count: rows.length, ops: rows })
  }),
  API_READ_LIMIT
)
