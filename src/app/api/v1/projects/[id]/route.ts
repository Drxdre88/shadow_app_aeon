import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { findProjectById, updateProject, deleteProject } from '@/lib/data/projects'
import { updateProjectSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  const project = await findProjectById(id, result.id)
  if (!project) return jsonError('Project not found', 404)
  return jsonData(project)
})

export const PUT = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  const existing = await findProjectById(id, result.id)
  if (!existing) return jsonError('Project not found', 404)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const project = await updateProject(id, parsed.data)
  return jsonData(project)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id } = await (ctx as Params).params

  const existing = await findProjectById(id, result.id)
  if (!existing) return jsonError('Project not found', 404)

  const deleted = await deleteProject(id)
  if (!deleted) return jsonError('Project not found', 404)
  return jsonData({ deleted: true })
})
