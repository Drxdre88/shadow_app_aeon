import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { createHangarRepoSchema } from '@/lib/data/validators'
import { createHangarRepo, listHangarRepos } from '@/lib/data/hangar-repos'
import { getGroupRole } from '@/lib/data/workspaces'

// AI Hangar (Sprint 1) — realm-scoped repo registry. Aeon holds the logical
// repo config (slug, git remote, default branch, allowed engines); host-local
// paths stay runner-side in repos.local.yaml. Any realm member can read the
// registry; editors and owners can register new repos.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth

    const url = new URL(request.url)
    const realmId = url.searchParams.get('realmId')
    if (!realmId) return jsonError('realmId is required', 400)

    const role = await getGroupRole(realmId, auth.id)
    if (!role) return jsonError('Not a member of this realm', 403)

    const activeOnly = url.searchParams.get('activeOnly') === 'true'
    const repos = await listHangarRepos(realmId, { activeOnly })
    return jsonData({ repos })
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = createHangarRepoSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const role = await getGroupRole(parsed.data.realmId, auth.id)
    if (!role) return jsonError('Not a member of this realm', 403)
    if (role === 'viewer') return jsonError('Viewers cannot modify the registry', 403)

    const repo = await createHangarRepo(parsed.data)
    return jsonData({ repo }, 201)
  }),
  API_WRITE_LIMIT
)
