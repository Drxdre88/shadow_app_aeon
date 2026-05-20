import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { listMemories as _listMemories, createMemory as _createMemory } from '@/lib/data/memories'
import { createMemorySchema } from '@/lib/data/validators'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const url = request.nextUrl
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const pinnedOnly = url.searchParams.get('pinned') === 'true'
    const includeArchived = url.searchParams.get('archived') === 'true'
    const realmId = url.searchParams.get('realmId') || undefined
    const projectId = url.searchParams.get('projectId') || undefined
    const taskId = url.searchParams.get('taskId') || undefined
    const type = url.searchParams.get('type') || undefined

    const data = await _listMemories(result.id, {
      limit: Math.min(Math.max(limit, 1), 200),
      offset: Math.max(offset, 0),
      pinnedOnly,
      includeArchived,
      realmId,
      projectId,
      taskId,
      type,
    })
    return jsonData(data)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = createMemorySchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const memory = await _createMemory(result.id, parsed.data)
    return jsonData(memory, 201)
  }),
  API_WRITE_LIMIT
)
