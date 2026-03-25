import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskWithDetails } from '@/lib/data/checklist'

type Params = { params: Promise<{ id: string; taskId: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const data = await findTaskWithDetails(taskId, id)
  if (!data) return jsonError('Task not found', 404)
  return jsonData(data)
})
