import { db } from '@/lib/db'
import { taskDependencies, boardTasks } from '@/lib/db/schema'
import { eq, and, or, inArray } from 'drizzle-orm'

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

export async function addDependency(blockerTaskId: string, blockedTaskId: string, projectId: string) {
  const tasks = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      or(eq(boardTasks.id, blockerTaskId), eq(boardTasks.id, blockedTaskId))
    ))
  if (tasks.length !== 2) throw new Error('Both tasks must belong to the project')
  await db
    .insert(taskDependencies)
    .values({ blockerTaskId, blockedTaskId })
    .onConflictDoNothing()
}

export async function removeDependency(blockerTaskId: string, blockedTaskId: string, projectId: string) {
  const tasks = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      inArray(boardTasks.id, [blockerTaskId, blockedTaskId])
    ))
  if (tasks.length === 0) throw new Error('No tasks belong to the project')
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.blockerTaskId, blockerTaskId),
        eq(taskDependencies.blockedTaskId, blockedTaskId)
      )
    )
}

export async function addDependenciesBatch(
  pairs: { blockerTaskId: string; blockedTaskId: string }[],
  projectId: string
) {
  if (pairs.length === 0) return { added: 0, skipped: 0 }

  const valid = pairs.filter((p) => p.blockerTaskId !== p.blockedTaskId)
  let skipped = pairs.length - valid.length

  const toInsert: { blockerTaskId: string; blockedTaskId: string }[] = []
  for (const pair of valid) {
    if (await wouldCreateCycle(pair.blockerTaskId, pair.blockedTaskId, projectId)) {
      skipped++
    } else {
      toInsert.push(pair)
      await addDependency(pair.blockerTaskId, pair.blockedTaskId, projectId)
    }
  }

  return { added: toInsert.length, skipped }
}

export async function wouldCreateCycle(
  blockerTaskId: string,
  blockedTaskId: string,
  projectId: string
): Promise<boolean> {
  const allDeps = await db
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))
    .where(eq(boardTasks.projectId, projectId))

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
