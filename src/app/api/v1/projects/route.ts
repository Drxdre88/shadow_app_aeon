import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { findProjects, createProject } from '@/lib/data/projects'
import { createProjectSchema } from '@/lib/data/validators'

export const GET = apiHandler(async (request: NextRequest) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100') || 100, 500)
  const offset = parseInt(url.searchParams.get('offset') || '0') || 0

  const data = await findProjects(result.id, limit, offset)
  return jsonData(data)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const project = await createProject(result.id, parsed.data)
  return jsonData(project, 201)
})
