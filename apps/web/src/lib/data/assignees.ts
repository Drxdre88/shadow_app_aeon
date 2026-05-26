import { db } from '@/lib/db'
import { taskAssignees, users, boardTasks } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

// Aeon side quest — task assignees data layer.

export type AssigneeRow = {
  userId: string
  name: string | null
  email: string
  image: string | null
  assignedAt: Date
  assignedBy: string | null
}

export async function getTaskAssignees(taskId: string): Promise<AssigneeRow[]> {
  return db
    .select({
      userId: taskAssignees.userId,
      name: users.name,
      email: users.email,
      image: users.image,
      assignedAt: taskAssignees.assignedAt,
      assignedBy: taskAssignees.assignedBy,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(eq(taskAssignees.taskId, taskId))
}

// Bulk fetch for a project — the board store hydrates assignees per card
// using this map keyed by taskId.
export async function getAssigneesForProject(projectId: string): Promise<Record<string, AssigneeRow[]>> {
  const taskIds = (await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))
  ).map((r) => r.id)

  if (taskIds.length === 0) return {}

  const rows = await db
    .select({
      taskId: taskAssignees.taskId,
      userId: taskAssignees.userId,
      name: users.name,
      email: users.email,
      image: users.image,
      assignedAt: taskAssignees.assignedAt,
      assignedBy: taskAssignees.assignedBy,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(inArray(taskAssignees.taskId, taskIds))

  const out: Record<string, AssigneeRow[]> = {}
  for (const r of rows) {
    const list = out[r.taskId] ?? (out[r.taskId] = [])
    list.push({
      userId: r.userId,
      name: r.name,
      email: r.email,
      image: r.image,
      assignedAt: r.assignedAt,
      assignedBy: r.assignedBy,
    })
  }
  return out
}

export async function assignUserToTask(taskId: string, userId: string, assignedBy: string) {
  const [row] = await db
    .insert(taskAssignees)
    .values({ taskId, userId, assignedBy })
    .onConflictDoNothing({ target: [taskAssignees.taskId, taskAssignees.userId] })
    .returning()
  return row ?? null
}

export async function unassignUserFromTask(taskId: string, userId: string) {
  const [deleted] = await db
    .delete(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .returning({ taskId: taskAssignees.taskId })
  return !!deleted
}
