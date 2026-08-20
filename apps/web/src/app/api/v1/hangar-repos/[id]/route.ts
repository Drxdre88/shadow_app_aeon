import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { updateHangarRepoSchema } from '@/lib/data/validators'
import { findHangarRepoById, updateHangarRepo, deleteHangarRepo } from '@/lib/data/hangar-repos'
import { getGroupRole } from '@/lib/data/workspaces'

type Params = { params: Promise<{ id: string }> }

// A non-uuid id would reach Postgres and come back as a 22P02 cast error, i.e.
// a 500 for what is really just a bad path segment.
const repoIdSchema = z.string().uuid()

// AI Hangar (Sprint 1) — single registry entry. Access is derived from the
// repo's own realm, so an unauthorized caller gets 403 rather than a hint
// about which realm the id belongs to.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params
    if (!repoIdSchema.safeParse(id).success) return jsonError('Repo not found', 404)

    const repo = await findHangarRepoById(id)
    if (!repo) return jsonError('Repo not found', 404)

    const role = await getGroupRole(repo.realmId, auth.id)
    if (!role) return jsonError('Not a member of this realm', 403)

    return jsonData({ repo })
  }),
  API_READ_LIMIT
)

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params
    if (!repoIdSchema.safeParse(id).success) return jsonError('Repo not found', 404)

    const existing = await findHangarRepoById(id)
    if (!existing) return jsonError('Repo not found', 404)

    const role = await getGroupRole(existing.realmId, auth.id)
    if (!role) return jsonError('Not a member of this realm', 403)
    if (role === 'viewer') return jsonError('Viewers cannot modify the registry', 403)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateHangarRepoSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const repo = await updateHangarRepo(id, parsed.data)
    return jsonData({ repo })
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const { id } = await (ctx as Params).params
    if (!repoIdSchema.safeParse(id).success) return jsonError('Repo not found', 404)

    const existing = await findHangarRepoById(id)
    if (!existing) return jsonError('Repo not found', 404)

    const role = await getGroupRole(existing.realmId, auth.id)
    if (role !== 'owner') return jsonError('Only owner can perform this action', 403)

    await deleteHangarRepo(id)
    return jsonData({ deleted: id })
  }),
  API_WRITE_LIMIT
)
