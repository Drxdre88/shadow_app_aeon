'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor } from './helpers'
import { fuseTasksSchema, fuseSnapshotSchema, type FuseTasksInput, type FuseSnapshot } from '@/lib/data/validators'
import { fuseTasks as _fuseTasks, type FuseResult } from '@/lib/data/fuse'
import { unfuseTasks as _unfuseTasks } from '@/lib/data/unfuse'
import { emitActivity } from '@/lib/data/activity'
import { captureBoardEvent } from '@/lib/kairos/auto-capture'

// Card fusion is a server action only — no MCP tool, no REST route (the
// parity invariant would demand both, and fusion is a board gesture).

export async function fuseBoardTasks(input: FuseTasksInput): Promise<FuseResult> {
  const parsed = fuseTasksSchema.parse(input)
  const userId = await requireEditor(parsed.projectId)
  const result = await _fuseTasks(parsed.projectId, parsed.survivorId, parsed.sourceId, parsed.name)

  const absorbedName = result.snapshot.source.name
  emitActivity(parsed.projectId, 'task', parsed.survivorId, 'updated', result.survivor.name, { fusedFrom: parsed.sourceId, fusedFromName: absorbedName }, userId).catch(() => {})
  emitActivity(parsed.projectId, 'task', parsed.sourceId, 'deleted', absorbedName, { fusedInto: parsed.survivorId }, userId).catch(() => {})
  captureBoardEvent({
    userId,
    projectId: parsed.projectId,
    taskId: parsed.survivorId,
    taskName: result.survivor.name,
    action: 'updated',
    metadata: { fusedFrom: absorbedName },
  }).catch(() => {})

  revalidatePath(`/project/${parsed.projectId}`)
  return result
}

export async function unfuseBoardTasks(projectId: string, snapshot: FuseSnapshot): Promise<void> {
  const parsed = fuseSnapshotSchema.parse(snapshot)
  if (parsed.projectId !== projectId) throw new Error('Snapshot belongs to another project')
  const userId = await requireEditor(projectId)
  await _unfuseTasks(parsed, userId)

  emitActivity(projectId, 'task', parsed.sourceId, 'restored', parsed.source.name, { unfusedFrom: parsed.survivorId }, userId).catch(() => {})
  revalidatePath(`/project/${projectId}`)
}
