import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { findProjects } from '@/lib/data/projects'
import { db } from '@/lib/db'
import { projectGroups, workspaceGroups } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Headroom above the 8s pool-acquire timeout so a hung connection surfaces as a
// caught 503, never a silent function-kill ("No response is returned").
export const maxDuration = 30

// GET /api/v1/projects/resolve?name=<exact-name>
// Case-insensitive exact-match resolver used by the Brain capture pipeline.
// Returns the project ID for a known name so per-repo session captures can
// anchor without anyone hard-coding UUIDs in .aeonrc files.
export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const name = (request.nextUrl.searchParams.get('name') ?? '').trim()
    if (!name) return jsonError('name query param required', 400)

    const target = name.toLowerCase()
    const all = await findProjects(result.id, 500, 0)
    const match = all.find((p) => p.name.toLowerCase() === target)
    if (!match) return jsonError('Project not found', 404)

    // Pull the non-personal realm so capture writes get both anchors.
    const realmRows = await db
      .select({ id: workspaceGroups.id, name: workspaceGroups.name, isPersonal: workspaceGroups.isPersonal })
      .from(projectGroups)
      .innerJoin(workspaceGroups, eq(workspaceGroups.id, projectGroups.groupId))
      .where(eq(projectGroups.projectId, match.id))
    const realm = realmRows.find((r) => !r.isPersonal) ?? realmRows[0] ?? null

    return jsonData({
      id: match.id,
      name: match.name,
      realmId: realm?.id ?? null,
      realmName: realm?.name ?? null,
    })
  }),
  API_READ_LIMIT
)
