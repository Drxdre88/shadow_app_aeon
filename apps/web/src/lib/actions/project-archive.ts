'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireMember, requireOwner } from './helpers'
import {
  findArchivedProjects as _findArchivedProjects,
  findProjectArchiveInfo as _findProjectArchiveInfo,
  setProjectArchivedForOwner as _setProjectArchivedForOwner,
} from '@/lib/data/project-archive'
import { setProjectArchivedSchema } from '@/lib/data/validators'
import { isProjectArchived, projectArchivedAt, type ArchivedProjectView } from '@/lib/projects/archive'

// The board Archive switch: only the board's creator archives or restores it;
// any member can read its state.

export async function getProjectArchiveSetting(
  projectId: string,
): Promise<{ archived: boolean; archivedAt: string | null; canToggle: boolean }> {
  const userId = await requireMember(projectId)
  const board = await _findProjectArchiveInfo(projectId)
  if (!board) throw new Error('Project not found')
  return {
    archived: isProjectArchived(board.settings),
    archivedAt: projectArchivedAt(board.settings),
    canToggle: board.userId === userId,
  }
}

export async function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<{ projectId: string; archived: boolean }> {
  const userId = await requireOwner(projectId)
  const parsed = setProjectArchivedSchema.parse({ archived })
  // Scoped to the board's creator in SQL: a realm owner or co-owner of a
  // shared board can't hide it from everyone else.
  const project = await _setProjectArchivedForOwner(projectId, userId, parsed.archived)
  if (!project) throw new Error('Only the person who created this board can archive it')
  revalidatePath('/dashboard', 'layout')
  revalidatePath(`/project/${projectId}`)
  return { projectId, archived: parsed.archived }
}

export async function getArchivedProjects(): Promise<ArchivedProjectView[]> {
  const userId = await requireAuth()
  return _findArchivedProjects(userId)
}
