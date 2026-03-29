import { db } from '@/lib/db'
import { projects, boardTasks, canvasNodes, ganttTasks } from '@/lib/db/schema'
import { eq, count, inArray } from 'drizzle-orm'

export const STORAGE_LIMITS = {
  tasks: 500,
  canvasNodes: 200,
  ganttTasks: 200,
} as const

export const SOFT_CAP_THRESHOLD = 0.8

export type EntityType = keyof typeof STORAGE_LIMITS

async function getUserProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))
  return rows.map((r) => r.id)
}

export async function checkStorageLimit(
  userId: string,
  entityType: EntityType,
): Promise<{ allowed: boolean; current: number; limit: number; remaining: number }> {
  const projectIds = await getUserProjectIds(userId)
  if (projectIds.length === 0) {
    const limit = STORAGE_LIMITS[entityType]
    return { allowed: true, current: 0, limit, remaining: limit }
  }

  let current = 0
  const limit = STORAGE_LIMITS[entityType]

  if (entityType === 'tasks') {
    const [row] = await db.select({ value: count() }).from(boardTasks).where(inArray(boardTasks.projectId, projectIds))
    current = row.value
  } else if (entityType === 'canvasNodes') {
    const [row] = await db.select({ value: count() }).from(canvasNodes).where(inArray(canvasNodes.projectId, projectIds))
    current = row.value
  } else if (entityType === 'ganttTasks') {
    const [row] = await db.select({ value: count() }).from(ganttTasks).where(inArray(ganttTasks.projectId, projectIds))
    current = row.value
  }

  return {
    allowed: current < limit,
    current,
    limit,
    remaining: Math.max(0, limit - current),
  }
}

export async function getStorageSummary(userId: string) {
  const projectIds = await getUserProjectIds(userId)
  if (projectIds.length === 0) {
    return { tasks: { current: 0, limit: STORAGE_LIMITS.tasks }, canvasNodes: { current: 0, limit: STORAGE_LIMITS.canvasNodes }, ganttTasks: { current: 0, limit: STORAGE_LIMITS.ganttTasks } }
  }

  const taskIds = (await db.select({ id: boardTasks.id }).from(boardTasks).where(inArray(boardTasks.projectId, projectIds))).map((r) => r.id)

  const [[canvasRow], [ganttRow]] = await Promise.all([
    db.select({ value: count() }).from(canvasNodes).where(inArray(canvasNodes.projectId, projectIds)),
    db.select({ value: count() }).from(ganttTasks).where(inArray(ganttTasks.projectId, projectIds)),
  ])

  return {
    tasks: { current: taskIds.length, limit: STORAGE_LIMITS.tasks },
    canvasNodes: { current: canvasRow.value, limit: STORAGE_LIMITS.canvasNodes },
    ganttTasks: { current: ganttRow.value, limit: STORAGE_LIMITS.ganttTasks },
  }
}
