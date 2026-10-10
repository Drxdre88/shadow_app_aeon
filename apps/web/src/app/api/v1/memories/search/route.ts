import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { searchMemoriesHybrid } from '@/lib/kairos/memory-search'
import { isEvalRead, noteAgentReads } from '@/lib/kairos/agent-reads'
import { searchMemoriesSchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const url = request.nextUrl
    // Phase 3B: q is optional when dominionId is given. Only set query when
    // the caller actually passed one, so the schema's "query or dominionId"
    // refinement gets a clean signal.
    const params: Record<string, unknown> = {
      limit: Number(url.searchParams.get('limit') ?? 20),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }
    const q = url.searchParams.get('q')
    if (q) params.query = q

    const type = url.searchParams.getAll('type')
    if (type.length === 1) params.type = type[0]
    else if (type.length > 1) params.type = type

    const source = url.searchParams.getAll('source')
    if (source.length === 1) params.source = source[0]
    else if (source.length > 1) params.source = source

    const realmId = url.searchParams.get('realmId')
    if (realmId) params.realmId = realmId
    const projectId = url.searchParams.get('projectId')
    if (projectId) params.projectId = projectId
    const taskId = url.searchParams.get('taskId')
    if (taskId) params.taskId = taskId
    const dominionId = url.searchParams.get('dominionId')
    if (dominionId) params.dominionId = dominionId
    const sinceDays = url.searchParams.get('sinceDays')
    if (sinceDays) params.sinceDays = Number(sinceDays)

    const tagsAny = url.searchParams.getAll('tagAny')
    if (tagsAny.length > 0) params.tagsAny = tagsAny
    const tagsAll = url.searchParams.getAll('tagAll')
    if (tagsAll.length > 0) params.tagsAll = tagsAll
    if (url.searchParams.get('pinned') === 'true') params.pinnedOnly = true
    if (url.searchParams.get('includeMachine') === 'true') params.includeMachine = true
    const expand = url.searchParams.get('expand')
    if (expand === 'true') params.expand = true
    else if (expand === 'false') params.expand = false

    const parsed = searchMemoriesSchema.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    // Same hybrid core as MCP search_memories; agent reads count as use.
    const data = await searchMemoriesHybrid(result.id, parsed.data)
    if (parsed.data.query && !isEvalRead(request.headers)) noteAgentReads(result.id, data.hits.map((h) => h.id), 'rest:search_memories')
    return jsonData(data)
  }),
  API_READ_LIMIT
)
