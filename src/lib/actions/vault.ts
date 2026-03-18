'use server'

import { revalidatePath } from 'next/cache'
import { requireOwnership } from './helpers'
import {
  findVaultTasks as _findVaultTasks,
  getVaultStats as _getVaultStats,
  vaultTask as _vaultTask,
  vaultTasksBatch as _vaultTasksBatch,
  restoreFromVault as _restoreFromVault,
} from '@/lib/data/vault'
import { emitActivity } from '@/lib/data/activity'
import { sendToVaultSchema, batchVaultSchema } from '@/lib/data/validators'

export async function getVaultTasks(projectId: string) {
  await requireOwnership(projectId)
  return _findVaultTasks(projectId)
}

export async function getVaultStatsSA(projectId: string) {
  await requireOwnership(projectId)
  return _getVaultStats(projectId)
}

export async function sendToVault(
  taskId: string,
  projectId: string,
  daysTaken: number | null,
  taskName?: string
) {
  await requireOwnership(projectId)
  const { taskId: validTaskId, daysTaken: validDaysTaken } = sendToVaultSchema.parse({ taskId, daysTaken })
  const vaulted = await _vaultTask(validTaskId, projectId, validDaysTaken)

  if (vaulted) {
    emitActivity(projectId, 'task', taskId, 'vaulted', taskName ?? vaulted.name).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return vaulted
}

export async function sendBatchToVault(
  projectId: string,
  entries: { taskId: string; daysTaken: number | null; taskName?: string }[]
) {
  await requireOwnership(projectId)
  const { entries: validEntries } = batchVaultSchema.parse({ entries })
  const vaulted = await _vaultTasksBatch(
    projectId,
    validEntries.map(e => ({ taskId: e.taskId, daysTaken: e.daysTaken }))
  )

  for (const entry of validEntries) {
    emitActivity(projectId, 'task', entry.taskId, 'vaulted', entry.taskName).catch(() => {})
  }

  revalidatePath(`/project/${projectId}`)
  return vaulted
}

export async function restoreVaultTask(vaultId: string, projectId: string) {
  await requireOwnership(projectId)
  const restored = await _restoreFromVault(vaultId, projectId)
  if (restored) {
    emitActivity(projectId, 'task', restored.id, 'restored', restored.name).catch(() => {})
  }
  revalidatePath(`/project/${projectId}`)
  return restored
}
