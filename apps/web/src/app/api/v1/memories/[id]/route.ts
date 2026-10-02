import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById, updateMemory as _updateMemory, deleteMemory as _deleteMemory } from '@/lib/data/memories'
import { updateMemorySchema } from '@/lib/data/validators'
import {
  constitutionPatchRefusal,
  isConstitutionRow,
  OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR,
} from '@/lib/kairos/constitution/amendment'
import type { Origin } from '@/lib/kairos/origin'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const memory = await findMemoryById(id, result.id)
    if (!memory) return jsonError('Memory not found', 404)
    return jsonData(memory)
  }),
  API_READ_LIMIT
)

export const PATCH = withRateLimit(
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

    const parsed = updateMemorySchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    // P2.5 origin by auth mode (cookie only when no Bearer header is sent).
    const isBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false
    // A bearer caller is an agent: it may not archive, retype or rewrite a
    // constitution row (owner-only; the signed-in session still can).
    if (isBearer) {
      const refusal = constitutionPatchRefusal(await findMemoryById(id, result.id), parsed.data)
      if (refusal) return jsonError(refusal, 403)
    }
    const origin: Origin = isBearer
      ? { kind: 'agent', via: 'rest' }
      : { kind: 'operator', via: 'rest-session' }
    const memory = await _updateMemory(id, result.id, parsed.data, { origin })
    if (!memory) return jsonError('Memory not found', 404)
    return jsonData(memory)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const isBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false
    if (isBearer && isConstitutionRow(await findMemoryById(id, result.id))) {
      return jsonError(OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR, 403)
    }

    const ok = await _deleteMemory(id, result.id)
    if (!ok) return jsonError('Memory not found', 404)
    return jsonData({ deleted: true })
  }),
  API_WRITE_LIMIT
)
