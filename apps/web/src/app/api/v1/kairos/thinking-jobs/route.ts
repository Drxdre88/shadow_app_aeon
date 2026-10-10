import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listThinkingJobsSchema } from '@/lib/data/validators/thinking'
import { listThinkingJobs } from '@/lib/kairos/thinking/queue'

// Kairos thinking queue — list recent jobs (no prompts). Mirrors the MCP
// list_thinking_jobs tool (docs/kairos/32 §3).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const params: Record<string, unknown> = {}
    const status = request.nextUrl.searchParams.get('status')
    if (status) params.status = status
    const limit = request.nextUrl.searchParams.get('limit')
    if (limit) params.limit = limit

    const parsed = listThinkingJobsSchema.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData(await listThinkingJobs(result.id, parsed.data))
  }),
  API_READ_LIMIT
)
