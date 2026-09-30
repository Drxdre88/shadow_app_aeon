import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { claimThinkingJobSchema } from '@/lib/data/validators/thinking'
import { claimThinkingJob } from '@/lib/kairos/thinking/queue'

// Kairos thinking queue — claim the next due job (plans lazily first). An
// empty queue is the normal case: 200 with job:null. Mirrors the MCP
// claim_thinking_job tool (docs/kairos/32 §3). Planning can cluster concept
// embeddings (Sundays, once per ISO week), hence the long function limit.

export const maxDuration = 300

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    let body: unknown = {}
    const raw = await request.text()
    if (raw.trim()) {
      try {
        body = JSON.parse(raw)
      } catch {
        return jsonError('Invalid JSON body', 400)
      }
    }

    const parsed = claimThinkingJobSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData(await claimThinkingJob(result.id, parsed.data))
  }),
  API_WRITE_LIMIT
)
