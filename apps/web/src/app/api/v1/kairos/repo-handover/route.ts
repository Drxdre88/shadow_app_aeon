import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readRepoHandover } from '@/lib/data/repo-handover'
import { getRepoHandoverSchema } from '@/lib/data/validators/kairos-repo-handover'
import { renderRepoHandoverMarkdown } from '@/lib/kairos/repo-memory/render'

// Mirrors the get_repo_handover MCP tool through the same validator + data fn (kairos-repo-handover-parity.test.ts).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getRepoHandoverSchema.safeParse({ repo: q.get('repo') ?? undefined, format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const handover = await readRepoHandover(result.id, { repo: parsed.data.repo })
    if (!handover) return jsonError(`Repo not recognised: ${parsed.data.repo}`, 404)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderRepoHandoverMarkdown(handover) })
    return jsonData(handover)
  }),
  API_READ_LIMIT
)
