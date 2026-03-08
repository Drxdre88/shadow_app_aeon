import { db } from '@/lib/db'
import { taskDependencies, boardTasks } from '@/lib/db/schema'
import { eq, and, or } from 'drizzle-orm'

export async function findDependencies(projectId: string) {
  return db
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))
    .where(eq(boardTasks.projectId, projectId))
}

export async function addDependency(blockerTaskId: string, blockedTaskId: string) {
  await db
    .insert(taskDependencies)
    .values({ blockerTaskId, blockedTaskId })
    .onConflictDoNothing()
}

export async function removeDependency(blockerTaskId: string, blockedTaskId: string) {
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.blockerTaskId, blockerTaskId),
        eq(taskDependencies.blockedTaskId, blockedTaskId)
      )
    )
}

export async function wouldCreateCycle(blockerTaskId: string, blockedTaskId: string): Promise<boolean> {
  const allDeps = await db
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)

  const graph = new Map<string, string[]>()
  for (const dep of allDeps) {
    const existing = graph.get(dep.blockerTaskId) || []
    existing.push(dep.blockedTaskId)
    graph.set(dep.blockerTaskId, existing)
  }

  const existingBlockedBy = graph.get(blockerTaskId) || []
  graph.set(blockerTaskId, [...existingBlockedBy, blockedTaskId])

  const visited = new Set<string>()
  const queue = [blockedTaskId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === blockerTaskId) return true
    if (visited.has(current)) continue
    visited.add(current)

    const neighbors = graph.get(current) || []
    queue.push(...neighbors)
  }

  return false
}
