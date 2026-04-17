import { db } from '@/lib/db'
import { taskDependencies, boardTasks } from '@/lib/db/schema'
import { eq, and, or, inArray } from 'drizzle-orm'
import { touchProject } from './projects'

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

export async function findDependenciesForTask(taskId: string) {
  return db
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .where(or(eq(taskDependencies.blockerTaskId, taskId), eq(taskDependencies.blockedTaskId, taskId)))
}

export async function addDependency(blockerTaskId: string, blockedTaskId: string, projectId: string) {
  if (blockerTaskId === blockedTaskId) throw new Error('A task cannot block itself')
  const tasks = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      or(eq(boardTasks.id, blockerTaskId), eq(boardTasks.id, blockedTaskId))
    ))
  if (tasks.length !== 2) throw new Error('Both tasks must belong to the project')
  const isCycle = await wouldCreateCycle(blockerTaskId, blockedTaskId, projectId)
  if (isCycle) throw new Error('Adding this dependency would create a circular chain')
  await db
    .insert(taskDependencies)
    .values({ blockerTaskId, blockedTaskId })
    .onConflictDoNothing()
  await touchProject(projectId, { type: 'dependency:changed' })
}

export async function removeDependency(blockerTaskId: string, blockedTaskId: string, projectId: string) {
  const tasks = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(
      eq(boardTasks.projectId, projectId),
      inArray(boardTasks.id, [blockerTaskId, blockedTaskId])
    ))
  if (tasks.length !== 2) throw new Error('Dependency not found')
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.blockerTaskId, blockerTaskId),
        eq(taskDependencies.blockedTaskId, blockedTaskId)
      )
    )
  await touchProject(projectId, { type: 'dependency:changed' })
}

export async function addDependenciesBatch(
  pairs: { blockerTaskId: string; blockedTaskId: string }[],
  projectId: string
) {
  if (pairs.length === 0) return { added: 0, skipped: 0 }

  const valid = pairs.filter((p) => p.blockerTaskId !== p.blockedTaskId)
  let skipped = pairs.length - valid.length

  const allDeps = await findDependencies(projectId)
  const graph = buildGraph(allDeps)

  const allTaskIds = [...new Set(valid.flatMap(p => [p.blockerTaskId, p.blockedTaskId]))]
  const projectTasks = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(and(eq(boardTasks.projectId, projectId), inArray(boardTasks.id, allTaskIds)))
  const validTaskIds = new Set(projectTasks.map(t => t.id))

  const toInsert: { blockerTaskId: string; blockedTaskId: string }[] = []
  for (const pair of valid) {
    if (!validTaskIds.has(pair.blockerTaskId) || !validTaskIds.has(pair.blockedTaskId)) {
      skipped++
      continue
    }
    if (wouldCreateCycleInGraph(graph, pair.blockerTaskId, pair.blockedTaskId)) {
      skipped++
    } else {
      toInsert.push(pair)
      const existing = graph.get(pair.blockerTaskId) || []
      existing.push(pair.blockedTaskId)
      graph.set(pair.blockerTaskId, existing)
    }
  }

  if (toInsert.length > 0) {
    await db.insert(taskDependencies).values(toInsert).onConflictDoNothing()
  }

  if (toInsert.length > 0) {
    await touchProject(projectId, { type: 'dependency:changed' })
  }
  return { added: toInsert.length, skipped }
}

function buildGraph(deps: { blockerTaskId: string; blockedTaskId: string }[]) {
  const graph = new Map<string, string[]>()
  for (const dep of deps) {
    const existing = graph.get(dep.blockerTaskId) || []
    existing.push(dep.blockedTaskId)
    graph.set(dep.blockerTaskId, existing)
  }
  return graph
}

function wouldCreateCycleInGraph(
  graph: Map<string, string[]>,
  blockerTaskId: string,
  blockedTaskId: string
): boolean {
  const visited = new Set<string>([blockerTaskId])
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

export async function wouldCreateCycle(
  blockerTaskId: string,
  blockedTaskId: string,
  projectId: string
): Promise<boolean> {
  const allDeps = await findDependencies(projectId)
  const graph = buildGraph(allDeps)
  const existing = graph.get(blockerTaskId) || []
  graph.set(blockerTaskId, [...existing, blockedTaskId])
  return wouldCreateCycleInGraph(graph, blockerTaskId, blockedTaskId)
}
