import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { listMemories as _listMemories, createMemory as _createMemory, getGraphForUser as _getGraphForUser } from '@/lib/data/memories'
import { createMemorySchema } from '@/lib/data/validators'
import type { CreateMemoryInput } from '@/lib/data/validators/memory'
import type { Origin } from '@/lib/kairos/origin'
import { recordTodayAfter } from '@/lib/kairos/today'

// Give DB-bound handlers headroom above the 8s pool-acquire timeout so a hung
// connection surfaces as a caught 503, never a silent function-kill.
export const maxDuration = 30

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const url = request.nextUrl
    if (url.searchParams.get('graph') === 'true') {
      const realmId = url.searchParams.get('realmId') || undefined
      const includeArchived = url.searchParams.get('archived') === 'true'
      const graph = await _getGraphForUser(result.id, { realmId, includeArchived })
      return jsonData(graph)
    }
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

    // P2.5 origin, fixed by the auth mode (authenticateRequest only reads the
    // session cookie when no Bearer header is sent): a bearer client is an
    // agent, a cookie session is the owner.
    const origin: Origin = request.headers.get('authorization')?.startsWith('Bearer ')
      ? { kind: 'agent', via: 'rest' }
      : { kind: 'operator', via: 'rest-session' }
    const memory = await _createMemory(result.id, parsed.data, { origin })
    if (parsed.data.type === 'session_summary') recordSessionCaptureToday(result.id, parsed.data, memory.id, origin)
    return jsonData(memory, 201)
  }),
  API_WRITE_LIMIT
)

// A coding session's closing summary lands in today's cross-channel log so
// every surface knows what the agents just did. Keyed per client session, so
// a re-posted summary replaces rather than duplicates. Fire-and-forget.
function recordSessionCaptureToday(userId: string, input: CreateMemoryInput, memoryId: string, origin: Origin): void {
  const meta = (input.sourceMetadata ?? {}) as Record<string, unknown>
  const client = typeof meta.client === 'string' && meta.client ? meta.client : input.source
  const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : memoryId
  const gist = input.summary?.trim() || input.execSummary?.[0] || ''
  recordTodayAfter(
    userId,
    {
      key: `session:${client}:${sessionId}`,
      channel: 'session',
      type: 'captured',
      text: `${client} session: ${input.title}${gist ? ` — ${gist}` : ''}`,
      ref: { memoryId },
      covered: 'memory',
    },
    origin,
  )
}
