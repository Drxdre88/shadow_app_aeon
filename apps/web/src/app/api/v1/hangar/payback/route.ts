import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { PaybackAccessError, readAgentPayback } from '@/lib/data/payback'
import { getAgentPaybackSchema } from '@/lib/data/validators/payback'
import { renderPaybackMarkdown } from '@/lib/kairos/payback/render'

// Mirrors the get_agent_payback MCP tool through the same validator + data fn (hangar-payback-parity.test.ts).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getAgentPaybackSchema.safeParse({
      period: q.get('period') ?? undefined,
      projectId: q.get('projectId') ?? undefined,
      groupBy: q.get('groupBy') ?? undefined,
      format: q.get('format') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const { period, projectId, groupBy } = parsed.data
    try {
      const view = await readAgentPayback(result.id, { period, projectId, groupBy })
      if (parsed.data.format === 'markdown') return jsonData({ markdown: renderPaybackMarkdown(view) })
      return jsonData(view)
    } catch (err) {
      if (err instanceof PaybackAccessError) return jsonError(err.message, 404)
      throw err
    }
  }),
  API_READ_LIMIT
)
