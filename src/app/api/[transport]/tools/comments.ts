import { z } from 'zod'
import {
  findComments,
  createComment,
  updateComment,
  deleteComment,
} from '@/lib/data/comments'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { emitActivity } from '@/lib/data/activity'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

async function requireOwnership(projectId: string, uid: string) {
  return !!(await verifyProjectOwnership(projectId, uid))
}

export const registerCommentTools: RegisterFn = (server) => {
  server.tool(
    'list_comments',
    'List all comments on a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
    },
    async ({ projectId, taskId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      return ok(await findComments(taskId, projectId))
    }
  )

  server.tool(
    'add_comment',
    'Add a comment to a task',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      content: z.string().min(1).max(5000).describe('Comment text'),
    },
    async ({ projectId, taskId, content }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const comment = await createComment(taskId, uid, content)
      emitActivity(projectId, 'comment', taskId, 'commented', content.slice(0, 80), { commentId: comment.id }, uid, 'agent').catch(() => {})
      return ok(comment)
    }
  )

  server.tool(
    'update_comment',
    'Edit a comment on a task (must be comment author)',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      commentId: z.string().uuid().describe('The comment UUID'),
      content: z.string().min(1).max(5000).describe('Updated comment text'),
    },
    async ({ projectId, taskId, commentId, content }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const comment = await updateComment(commentId, taskId, uid, content)
      return comment ? ok(comment) : notFound('Comment')
    }
  )

  server.tool(
    'delete_comment',
    'Delete a comment from a task (must be comment author)',
    {
      projectId: z.string().uuid().describe('The project UUID'),
      taskId: z.string().uuid().describe('The task UUID'),
      commentId: z.string().uuid().describe('The comment UUID'),
    },
    async ({ projectId, taskId, commentId }, extra) => {
      const uid = getUserId(extra)
      if (!await requireOwnership(projectId, uid)) return notFound('Project')
      const deleted = await deleteComment(commentId, taskId, uid)
      return deleted ? ok({ deleted: true }) : notFound('Comment')
    }
  )
}
