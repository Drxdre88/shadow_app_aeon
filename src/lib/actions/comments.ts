'use server'

import { requireOwnership, requireAuth } from './helpers'
import {
  findComments as _findComments,
  createComment as _createComment,
  updateComment as _updateComment,
  deleteComment as _deleteComment,
} from '@/lib/data/comments'
import { emitActivity } from '@/lib/data/activity'

export async function getComments(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  return _findComments(taskId, projectId)
}

export async function addComment(taskId: string, projectId: string, content: string) {
  const userId = await requireOwnership(projectId)
  const comment = await _createComment(taskId, userId, content)
  emitActivity(projectId, 'comment', taskId, 'commented', content.slice(0, 80), { commentId: comment.id }, userId).catch(() => {})
  return comment
}

export async function editComment(commentId: string, taskId: string, projectId: string, content: string) {
  const userId = await requireOwnership(projectId)
  return _updateComment(commentId, taskId, userId, content)
}

export async function removeComment(commentId: string, taskId: string, projectId: string) {
  const userId = await requireOwnership(projectId)
  return _deleteComment(commentId, taskId, userId)
}
