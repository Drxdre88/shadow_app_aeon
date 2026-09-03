import { db } from '@/lib/db'
import { taskAssignees, users, boardTasks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { touchProject } from './projects'
import { findMemberProfilesForProject, type MemberProfileRow } from './member-profiles'

// Aeon side quest — task assignees data layer.

export type AssigneeRow = {
  userId: string
  /** The realm's display name for them when one is set, else their account name. */
  name: string | null
  email: string
  image: string | null
  /** Realm override, or null to derive as before. */
  initials: string | null
  /** Realm override, or null for the hue derived from the seed. */
  color: string | null
  assignedAt: Date
  assignedBy: string | null
}

/** Overlay one realm override onto a row. A member without one is untouched. */
function withProfile<T extends { userId: string; name: string | null }>(
  row: T,
  profiles: Map<string, MemberProfileRow>,
): T & { initials: string | null; color: string | null } {
  const p = profiles.get(row.userId)
  return {
    ...row,
    name: p?.displayName ?? row.name,
    initials: p?.initials ?? null,
    color: p?.color ?? null,
  }
}

export async function getTaskAssignees(taskId: string): Promise<AssigneeRow[]> {
  const rows = await db
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

  if (rows.length === 0) return []
  const projectId = await projectIdForTask(taskId)
  const profiles = projectId ? await findMemberProfilesForProject(projectId) : new Map()
  return rows.map((r) => withProfile(r, profiles))
}

// Bulk fetch for a project — the board store hydrates assignees per card
// using this map keyed by taskId.
export async function getAssigneesForProject(projectId: string): Promise<Record<string, AssigneeRow[]>> {
  // Single round trip: join through board_tasks instead of prefetching the
  // project's task ids (this runs on every board load, cold Neon included).
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
    .innerJoin(boardTasks, eq(boardTasks.id, taskAssignees.taskId))
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(eq(boardTasks.projectId, projectId))

  // One extra query for the whole board rather than a join per row — the realm
  // is a property of the project, not of any individual assignment.
  const profiles = await findMemberProfilesForProject(projectId)

  const out: Record<string, AssigneeRow[]> = {}
  for (const r of rows) {
    const list = out[r.taskId] ?? (out[r.taskId] = [])
    list.push(withProfile({
      userId: r.userId,
      name: r.name,
      email: r.email,
      image: r.image,
      assignedAt: r.assignedAt,
      assignedBy: r.assignedBy,
    }, profiles))
  }
  return out
}

// Assign/unassign carry no projectId of their own — the owning project is
// resolved from the task so every caller (actions, MCP, REST) gets the
// boardVersion bump + Pusher event without having to pass it down.
async function projectIdForTask(taskId: string): Promise<string | null> {
  const [task] = await db
    .select({ projectId: boardTasks.projectId })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))
  return task?.projectId ?? null
}

// knownProjectId is optional purely as a round-trip saver — callers that
// already verified the task belongs to a project pass it to skip the lookup
// (one less query against a possibly-cold Neon).
export async function assignUserToTask(taskId: string, userId: string, assignedBy: string, knownProjectId?: string) {
  const [row] = await db
    .insert(taskAssignees)
    .values({ taskId, userId, assignedBy })
    .onConflictDoNothing({ target: [taskAssignees.taskId, taskAssignees.userId] })
    .returning()

  if (row) {
    const projectId = knownProjectId ?? await projectIdForTask(taskId)
    if (projectId) await touchProject(projectId, { type: 'task:assigned' })
  }

  return row ?? null
}

export async function unassignUserFromTask(taskId: string, userId: string, knownProjectId?: string) {
  const [deleted] = await db
    .delete(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .returning({ taskId: taskAssignees.taskId })

  if (deleted) {
    const projectId = knownProjectId ?? await projectIdForTask(taskId)
    if (projectId) await touchProject(projectId, { type: 'task:unassigned' })
  }

  return !!deleted
}
