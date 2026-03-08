'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findDependencies as _findDependencies,
  addDependency as _addDependency,
  removeDependency as _removeDependency,
  wouldCreateCycle,
} from '@/lib/data/dependencies'

export async function getDependencies(projectId: string) {
  await requireOwnership(projectId)
  return _findDependencies(projectId)
}

export async function addTaskDependency(
  projectId: string,
  blockerTaskId: string,
  blockedTaskId: string
) {
  await requireOwnership(projectId)

  if (blockerTaskId === blockedTaskId) {
    throw new Error('A task cannot depend on itself')
  }

  const cyclic = await wouldCreateCycle(blockerTaskId, blockedTaskId)
  if (cyclic) {
    throw new Error('This dependency would create a cycle')
  }

  await _addDependency(blockerTaskId, blockedTaskId)
  revalidatePath(`/project/${projectId}`)
}

export async function removeTaskDependency(
  projectId: string,
  blockerTaskId: string,
  blockedTaskId: string
) {
  await requireOwnership(projectId)
  await _removeDependency(blockerTaskId, blockedTaskId)
  revalidatePath(`/project/${projectId}`)
}
