import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findTaskById } from '@/lib/data/tasks'
import { updateComment, deleteComment } from '@/lib/data/comments'
import { updateCommentSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; taskId: string; commentId: string }> }

export const PUT = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId, commentId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const task = await findTaskById(taskId, id)
  if (!task) return jsonError('Task not found', 404)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const parsed = updateCommentSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const comment = await updateComment(commentId, taskId, result.id, parsed.data.content)
  if (!comment) return jsonError('Comment not found', 404)
  return jsonData(comment)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, taskId, commentId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const task = await findTaskById(taskId, id)
  if (!task) return jsonError('Task not found', 404)

  const deleted = await deleteComment(commentId, taskId, result.id)
  if (!deleted) return jsonError('Comment not found', 404)
  return jsonData({ deleted: true })
})
