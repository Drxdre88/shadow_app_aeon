'use server'

import { requireOwnership, requireEditor } from './helpers'
import {
  findComments as _findComments,
  createComment as _createComment,
  updateComment as _updateComment,
  deleteComment as _deleteComment,
} from '@/lib/data/comments'
import { emitActivity } from '@/lib/data/activity'
import { findTaskById } from '@/lib/data/tasks'

// Access is granted per project, so the task has to be proven to live in the
// project that was authorised — otherwise a comment could be written onto a
// card in a project the caller never passed a guard for.
async function requireTaskInProject(taskId: string, projectId: string) {
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')
}

export async function getComments(taskId: string, projectId: string) {
  await requireOwnership(projectId)
  return _findComments(taskId, projectId)
}

export async function addComment(taskId: string, projectId: string, content: string) {
  const userId = await requireEditor(projectId)
  await requireTaskInProject(taskId, projectId)
  const comment = await _createComment(taskId, projectId, userId, content)
  emitActivity(projectId, 'comment', taskId, 'commented', content.slice(0, 80), { commentId: comment.id }, userId).catch(() => {})
  return comment
}

export async function editComment(commentId: string, taskId: string, projectId: string, content: string) {
  const userId = await requireEditor(projectId)
  await requireTaskInProject(taskId, projectId)
  return _updateComment(commentId, taskId, projectId, userId, content)
}

export async function removeComment(commentId: string, taskId: string, projectId: string) {
  const userId = await requireEditor(projectId)
  await requireTaskInProject(taskId, projectId)
  return _deleteComment(commentId, taskId, projectId, userId)
}
