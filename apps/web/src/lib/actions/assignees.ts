'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireEditor, requireMember } from './helpers'
import { findAssignableMembers } from '@/lib/data/members'
import {
  getTaskAssignees as _getTaskAssignees,
  getAssigneesForProject as _getAssigneesForProject,
  assignUserToTask as _assignUserToTask,
  unassignUserFromTask as _unassignUserFromTask,
} from '@/lib/data/assignees'
import { findTaskById as _findTaskById } from '@/lib/data/tasks'
import { emitActivity } from '@/lib/data/activity'
import { captureBoardEvent } from '@/lib/kairos/auto-capture'

const idSchema = z.string().uuid()

// Aeon side quest — Trello-style multi-assign actions.

export async function listTaskAssignees(projectId: string, taskId: string) {
  await requireMember(projectId)
  idSchema.parse(taskId)
  return _getTaskAssignees(taskId)
}

export async function listAssigneesForProject(projectId: string) {
  await requireMember(projectId)
  return _getAssigneesForProject(projectId)
}

export async function assignTaskAction(projectId: string, taskId: string, userId: string) {
  const actorId = await requireEditor(projectId)
  idSchema.parse(taskId)
  idSchema.parse(userId)

  // Guard: the task must belong to the project the caller was authorized for —
  // without this, an editor of project A could write assignees onto project
  // B's tasks (and broadcast on B's channel) by passing a foreign taskId.
  const task = await _findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  // Guard: only project members can be assigned (owner + explicit + realm).
  const members = await findAssignableMembers(projectId)
  if (!members.some((m) => m.userId === userId)) {
    throw new Error('User is not a member of this project')
  }

  const row = await _assignUserToTask(taskId, userId, actorId)
  if (row) {
    const assignedMember = members.find((m) => m.userId === userId)
    const displayName = assignedMember?.name ?? assignedMember?.email ?? null
    emitActivity(
      projectId,
      'task',
      taskId,
      'assigned',
      task?.name ?? undefined,
      { assigneeId: userId, assigneeName: displayName },
      actorId,
    ).catch(() => {})
    captureBoardEvent({
      userId: actorId,
      projectId,
      taskId,
      taskName: task?.name,
      action: 'updated',
      metadata: { assigned: userId, assigneeName: displayName },
    }).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return row
}

export async function unassignTaskAction(projectId: string, taskId: string, userId: string) {
  const actorId = await requireEditor(projectId)
  idSchema.parse(taskId)
  idSchema.parse(userId)

  // Same cross-project guard as assignTaskAction.
  const task = await _findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  const ok = await _unassignUserFromTask(taskId, userId)
  if (ok) {
    emitActivity(
      projectId,
      'task',
      taskId,
      'unassigned',
      task?.name ?? undefined,
      { unassignedId: userId },
      actorId,
    ).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return ok
}
