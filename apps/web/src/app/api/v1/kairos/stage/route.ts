import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosStage, toKairosStageView } from '@/lib/data/kairos-stage'
import { getKairosStageSchema } from '@/lib/data/validators/kairos-stage'
import { renderStageBlock } from '@/lib/kairos/stage/render'

// Mirrors the get_kairos_stage MCP tool through the same validator + data fns
// (kairos-stage-parity.test.ts enforces this). Read-only and owner-scoped: the
// stage is written only by the server-side selector.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosStageSchema.safeParse({
      format: q.get('format') ?? undefined,
      pool: q.get('pool') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const now = new Date()
    const state = await readKairosStage(result.id)
    if (parsed.data.format === 'markdown') {
      const { block, cycle } = renderStageBlock(state, { now })
      return jsonData({ cycle, markdown: block })
    }
    return jsonData(toKairosStageView(state, { now, pool: parsed.data.pool === '1' }))
  }),
  API_READ_LIMIT
)
