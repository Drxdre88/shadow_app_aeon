import { db } from '@/lib/db'
import { virtualMembers, taskVirtualAssignees, boardTasks, projectGroups } from '@/lib/db/schema'
import { eq, and, TransactionRollbackError } from 'drizzle-orm'
import { touchProject } from './projects'
import type { CreateVirtualMemberInput, UpdateVirtualMemberInput } from './validators'

// Virtual team members — realm-scoped assignable people without an account.
// Mirrors the shape of lib/data/assignees.ts for real members.

export type VirtualMemberRow = {
  id: string
  realmId: string
  name: string
  initials: string
  color: string
  createdById: string | null
  createdAt: Date
}

export type VirtualAssigneeRow = {
  virtualMemberId: string
  name: string
  initials: string
  color: string
  assignedAt: Date
  assignedBy: string | null
}

export function deriveInitials(name: string): string {
  const seed = name.trim()
  // Spread to code points so astral-plane leads (emoji, CJK extensions) don't
  // split into unpaired surrogates.
  const initials = seed
    .split(/\s+/)
    .map((s) => [...s][0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const out = initials || ([...seed][0]?.toUpperCase() ?? '?')
  // Hard clamp to the varchar(4) column. Two code points in is not two out:
  // uppercasing expands some characters (ﬃ -> FFI, ß -> SS), so a name like
  // "ﬃx ﬃy" derives six characters and the INSERT fails with "value too long".
  // Slice by code point so an astral lead never loses half its surrogate pair.
  return [...out].slice(0, 4).join('')
}

export async function listVirtualMembers(realmId: string): Promise<VirtualMemberRow[]> {
  return db
    .select()
    .from(virtualMembers)
    .where(eq(virtualMembers.realmId, realmId))
    .orderBy(virtualMembers.createdAt)
}

// Every virtual member assignable on this project: those belonging to any
// realm the project is in — the exact realm-scope rule findAssignableMembers
// applies to real members.
export async function findVirtualMembersForProject(projectId: string): Promise<VirtualMemberRow[]> {
  return db
    .select({
      id: virtualMembers.id,
      realmId: virtualMembers.realmId,
      name: virtualMembers.name,
      initials: virtualMembers.initials,
      color: virtualMembers.color,
      createdById: virtualMembers.createdById,
      createdAt: virtualMembers.createdAt,
    })
    .from(projectGroups)
    .innerJoin(virtualMembers, eq(virtualMembers.realmId, projectGroups.groupId))
    .where(eq(projectGroups.projectId, projectId))
    .orderBy(virtualMembers.createdAt)
}

// Realms a project belongs to, oldest membership first — the create-from-board
// flow scopes a new virtual member to the project's primary (first) realm.
export async function findRealmIdsForProject(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: projectGroups.groupId })
    .from(projectGroups)
    .where(eq(projectGroups.projectId, projectId))
    .orderBy(projectGroups.createdAt)
  return rows.map((r) => r.groupId)
}

export async function findVirtualMemberById(id: string): Promise<VirtualMemberRow | null> {
  const [row] = await db.select().from(virtualMembers).where(eq(virtualMembers.id, id))
  return row ?? null
}

export async function createVirtualMember(
  realmId: string,
  input: CreateVirtualMemberInput,
  createdById: string,
): Promise<VirtualMemberRow> {
  const [row] = await db
    .insert(virtualMembers)
    .values({
      realmId,
      name: input.name,
      initials: input.initials ?? deriveInitials(input.name),
      color: input.color ?? 'purple',
      createdById,
    })
    .returning()
  return row
}

// realm-scoped WHERE so a caller authorized for realm A can never rename a
// member of realm B by guessing its id.
export async function updateVirtualMember(
  id: string,
  realmId: string,
  updates: UpdateVirtualMemberInput,
): Promise<VirtualMemberRow | null> {
  const set: Partial<{ name: string; initials: string; color: string }> = {}
  if (updates.name !== undefined) set.name = updates.name
  if (updates.initials !== undefined) set.initials = updates.initials
  if (updates.color !== undefined) set.color = updates.color
  if (Object.keys(set).length === 0) {
    // Keep the realm scope even on a no-op update — an empty PATCH must not
    // leak another realm's member row.
    const row = await findVirtualMemberById(id)
    return row && row.realmId === realmId ? row : null
  }

  const [row] = await db
    .update(virtualMembers)
    .set(set)
    .where(and(eq(virtualMembers.id, id), eq(virtualMembers.realmId, realmId)))
    .returning()
  return row ?? null
}

// Deletes the member and its assignments atomically, then bumps every project
// that lost pills so peers' boards refresh. The assignment rows would cascade
// at the DB level anyway; deleting them explicitly inside the transaction lets
// us collect the affected projects from the same statement.
export async function deleteVirtualMember(id: string, realmId: string): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const taskRows = await tx
      .select({ projectId: boardTasks.projectId })
      .from(taskVirtualAssignees)
      .innerJoin(boardTasks, eq(boardTasks.id, taskVirtualAssignees.taskId))
      .where(eq(taskVirtualAssignees.virtualMemberId, id))

    await tx.delete(taskVirtualAssignees).where(eq(taskVirtualAssignees.virtualMemberId, id))

    const [deleted] = await tx
      .delete(virtualMembers)
      .where(and(eq(virtualMembers.id, id), eq(virtualMembers.realmId, realmId)))
      .returning({ id: virtualMembers.id })

    if (!deleted) tx.rollback()
    return { projectIds: [...new Set(taskRows.map((r) => r.projectId))] }
  }).catch((err: unknown) => {
    // drizzle tx.rollback() throws TransactionRollbackError — a missing member
    // is a boolean outcome here, not an exception. Match the class, never the
    // message: a real infrastructure failure that happens to say "rollback"
    // must fail loudly instead of being reported as a clean 404.
    if (err instanceof TransactionRollbackError) return null
    throw err
  })

  if (!result) return false
  for (const projectId of result.projectIds) {
    await touchProject(projectId, { type: 'task:unassigned' })
  }
  return true
}

// Bulk fetch for a project — merged into the board's assignees hydration so
// virtual pills render alongside real ones.
export async function getVirtualAssigneesForProject(projectId: string): Promise<Record<string, VirtualAssigneeRow[]>> {
  // Single round trip: join through board_tasks (mirrors getAssigneesForProject).
  const rows = await db
    .select({
      taskId: taskVirtualAssignees.taskId,
      virtualMemberId: taskVirtualAssignees.virtualMemberId,
      name: virtualMembers.name,
      initials: virtualMembers.initials,
      color: virtualMembers.color,
      assignedAt: taskVirtualAssignees.assignedAt,
      assignedBy: taskVirtualAssignees.assignedBy,
    })
    .from(taskVirtualAssignees)
    .innerJoin(boardTasks, eq(boardTasks.id, taskVirtualAssignees.taskId))
    .innerJoin(virtualMembers, eq(virtualMembers.id, taskVirtualAssignees.virtualMemberId))
    .where(eq(boardTasks.projectId, projectId))

  const out: Record<string, VirtualAssigneeRow[]> = {}
  for (const r of rows) {
    const list = out[r.taskId] ?? (out[r.taskId] = [])
    list.push({
      virtualMemberId: r.virtualMemberId,
      name: r.name,
      initials: r.initials,
      color: r.color,
      assignedAt: r.assignedAt,
      assignedBy: r.assignedBy,
    })
  }
  return out
}

// True when the virtual member belongs to a realm this project is in.
export async function isVirtualMemberAssignable(virtualMemberId: string, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: virtualMembers.id })
    .from(virtualMembers)
    .innerJoin(projectGroups, and(
      eq(projectGroups.groupId, virtualMembers.realmId),
      eq(projectGroups.projectId, projectId),
    ))
    .where(eq(virtualMembers.id, virtualMemberId))
  return rows.length > 0
}

async function projectIdForTask(taskId: string): Promise<string | null> {
  const [task] = await db
    .select({ projectId: boardTasks.projectId })
    .from(boardTasks)
    .where(eq(boardTasks.id, taskId))
  return task?.projectId ?? null
}

// projectId is optional purely as a round-trip saver — callers that already
// verified the task's project pass it so we skip the lookup.
export async function assignVirtualMemberToTask(
  taskId: string,
  virtualMemberId: string,
  assignedBy: string,
  projectId?: string,
) {
  const [row] = await db
    .insert(taskVirtualAssignees)
    .values({ taskId, virtualMemberId, assignedBy })
    .onConflictDoNothing({ target: [taskVirtualAssignees.taskId, taskVirtualAssignees.virtualMemberId] })
    .returning()

  if (row) {
    const pid = projectId ?? await projectIdForTask(taskId)
    if (pid) await touchProject(pid, { type: 'task:assigned' })
  }

  return row ?? null
}

export async function unassignVirtualMemberFromTask(
  taskId: string,
  virtualMemberId: string,
  projectId?: string,
) {
  const [deleted] = await db
    .delete(taskVirtualAssignees)
    .where(and(
      eq(taskVirtualAssignees.taskId, taskId),
      eq(taskVirtualAssignees.virtualMemberId, virtualMemberId),
    ))
    .returning({ taskId: taskVirtualAssignees.taskId })

  if (deleted) {
    const pid = projectId ?? await projectIdForTask(taskId)
    if (pid) await touchProject(pid, { type: 'task:unassigned' })
  }

  return !!deleted
}
