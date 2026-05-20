import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { addLink, targetMemoryExists } from '@/lib/data/memories'
import { addLinkSchema } from '@/lib/data/validators'
import { verifyProjectAccess } from '@/lib/data/projects'
import { db } from '@/lib/db'
import { boardTasks, groupMembers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

async function verifyLinkTarget(userId: string, targetKind: string, target: string): Promise<string | null> {
  if (targetKind === 'url') return null
  if (targetKind === 'memory') {
    const ok = await targetMemoryExists(target, userId)
    return ok ? null : 'Target memory not found'
  }
  if (targetKind === 'realm') {
    const [m] = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, target), eq(groupMembers.userId, userId)))
      .limit(1)
    return m ? null : 'Realm not accessible'
  }
  if (targetKind === 'project') {
    const access = await verifyProjectAccess(target, userId)
    return access ? null : 'Project not accessible'
  }
  if (targetKind === 'task') {
    const [t] = await db
      .select({ projectId: boardTasks.projectId })
      .from(boardTasks)
      .where(eq(boardTasks.id, target))
      .limit(1)
    if (!t) return 'Task not found'
    const access = await verifyProjectAccess(t.projectId, userId)
    return access ? null : 'Task not accessible'
  }
  return 'Unknown target kind'
}

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = addLinkSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const err = await verifyLinkTarget(result.id, parsed.data.targetKind, parsed.data.target)
    if (err) return jsonError(err, 400)

    const link = await addLink(id, result.id, parsed.data)
    if (!link) return jsonError('Memory not found', 404)
    return jsonData(link, link.created ? 201 : 200)
  }),
  API_WRITE_LIMIT
)
