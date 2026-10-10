import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { submitThinkingJobSchema } from '@/lib/data/validators/thinking'
import { submitErrorStatus, submitThinkingJob } from '@/lib/kairos/thinking/queue'

type Params = { params: Promise<{ id: string }> }

// Kairos thinking queue — submit raw model text for a claimed job. The
// server parses strictly, grounds, mints ids and persists via the kind's
// handler. Mirrors the MCP submit_thinking_job tool (docs/kairos/32 §3).

// An idea_generate apply embeds, novelty-checks and retrieves evidence for up
// to 16 candidates inside this request (docs/kairos/35) — same budget as claim.
export const maxDuration = 300

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied
    const { id } = await (ctx as Params).params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Body must be a JSON object', 400)

    const parsed = submitThinkingJobSchema.safeParse({ ...(body as Record<string, unknown>), jobId: id })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const outcome = await submitThinkingJob(result.id, parsed.data)
    if (!outcome.ok) return jsonError(`${outcome.code}: ${outcome.error}`, submitErrorStatus(outcome.code))
    return jsonData(outcome)
  }),
  API_WRITE_LIMIT
)
