import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findRows, createRow } from '@/lib/data/gantt'
import { createRowSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const data = await findRows(id)
    return jsonData(data)
  }),
  API_READ_LIMIT
)

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = createRowSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const row = await createRow(id, parsed.data)
    return jsonData(row, 201)
  }),
  API_WRITE_LIMIT
)
