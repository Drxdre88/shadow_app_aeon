import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { searchMemoriesFts } from '@/lib/data/memories'
import { searchMemoriesSchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const url = request.nextUrl
    const params: Record<string, unknown> = {
      query: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit') ?? 20),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }
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

    const tagsAny = url.searchParams.getAll('tagAny')
    if (tagsAny.length > 0) params.tagsAny = tagsAny
    const tagsAll = url.searchParams.getAll('tagAll')
    if (tagsAll.length > 0) params.tagsAll = tagsAll
    if (url.searchParams.get('pinned') === 'true') params.pinnedOnly = true

    const parsed = searchMemoriesSchema.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const data = await searchMemoriesFts(result.id, parsed.data)
    return jsonData(data)
  }),
  API_READ_LIMIT
)
