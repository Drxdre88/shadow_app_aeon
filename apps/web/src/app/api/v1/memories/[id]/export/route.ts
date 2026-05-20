import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById } from '@/lib/data/memories'
import { memoryToMarkdown, MARKDOWN_CONTENT_TYPE } from '@/lib/data/memoriesMarkdown'
import { db } from '@/lib/db'
import { workspaceGroups, projects, boardTasks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const memory = await findMemoryById(id, result.id)
    if (!memory) return jsonError('Memory not found', 404)

    // Resolve anchor names in parallel for the .md export (kept out of the
    // serializer so it stays pure).
    const [realm, project, task] = await Promise.all([
      memory.realmId
        ? db.select({ name: workspaceGroups.name }).from(workspaceGroups).where(eq(workspaceGroups.id, memory.realmId)).limit(1)
        : Promise.resolve([]),
      memory.projectId
        ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, memory.projectId)).limit(1)
        : Promise.resolve([]),
      memory.taskId
        ? db.select({ name: boardTasks.name }).from(boardTasks).where(eq(boardTasks.id, memory.taskId)).limit(1)
        : Promise.resolve([]),
    ])

    const md = memoryToMarkdown(memory, {
      realmName:   realm[0]?.name ?? null,
      projectName: project[0]?.name ?? null,
      taskName:    task[0]?.name ?? null,
    })

    return new NextResponse(md, {
      status: 200,
      headers: {
        'content-type': MARKDOWN_CONTENT_TYPE,
        'content-disposition': `attachment; filename="${memory.id}.md"`,
      },
    })
  }),
  API_READ_LIMIT
)
