'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import { dependencyPairSchema } from '@/lib/data/validators'
import {
  findDependencies as _findDependencies,
  addDependency as _addDependency,
  removeDependency as _removeDependency,
  wouldCreateCycle,
} from '@/lib/data/dependencies'
import { emitActivity } from '@/lib/data/activity'

export async function addTaskDependency(
  projectId: string,
  blockerTaskId: string,
  blockedTaskId: string
) {
  const userId = await requireEditor(projectId)

  const parsed = dependencyPairSchema.parse({ blockerTaskId, blockedTaskId })

  const cyclic = await wouldCreateCycle(parsed.blockerTaskId, parsed.blockedTaskId, projectId)
  if (cyclic) {
    throw new Error('This dependency would create a cycle')
  }

  await _addDependency(parsed.blockerTaskId, parsed.blockedTaskId, projectId)
  emitActivity(projectId, 'dependency', parsed.blockerTaskId, 'dependency_added', undefined, {
    blockerTaskId: parsed.blockerTaskId,
    blockedTaskId: parsed.blockedTaskId,
  }, userId).catch(() => {})
  revalidatePath(`/project/${projectId}`)
}

export async function removeTaskDependency(
  projectId: string,
  blockerTaskId: string,
  blockedTaskId: string
) {
  const userId = await requireEditor(projectId)
  await _removeDependency(blockerTaskId, blockedTaskId, projectId)
  emitActivity(projectId, 'dependency', blockerTaskId, 'dependency_removed', undefined, {
    blockerTaskId,
    blockedTaskId,
  }, userId).catch(() => {})
  revalidatePath(`/project/${projectId}`)
}
