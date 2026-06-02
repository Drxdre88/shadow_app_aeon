import { db } from '@/lib/db'
import {
  dominions,
  dominionRepos,
  dominionObjectives,
  projects,
  memories,
  boardTasks,
} from '@/lib/db/schema'
import { eq, and, asc, desc, isNull, ne, sql } from 'drizzle-orm'
import type {
  CreateDominionInput,
  UpdateDominionInput,
  CreateDominionObjectiveInput,
  UpdateDominionObjectiveInput,
} from './validators'

export async function findDominionsByUser(userId: string) {
  return db
    .select()
    .from(dominions)
    .where(eq(dominions.userId, userId))
    .orderBy(asc(dominions.sortOrder), asc(dominions.name))
}

export async function findDominionById(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(dominions)
    .where(and(eq(dominions.id, id), eq(dominions.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function createDominion(userId: string, input: CreateDominionInput) {
  const [row] = await db
    .insert(dominions)
    .values({
      userId,
      name: input.name,
      color: input.color ?? 'purple',
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? 0,
      vision: input.vision ?? null,
      missionLong: input.missionLong ?? null,
    })
    .returning()
  return row
}

export async function updateDominion(id: string, userId: string, patch: UpdateDominionInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name !== undefined)        update.name = patch.name
  if (patch.color !== undefined)       update.color = patch.color
  if (patch.icon !== undefined)        update.icon = patch.icon
  if (patch.sortOrder !== undefined)   update.sortOrder = patch.sortOrder
  if (patch.vision !== undefined)      update.vision = patch.vision
  if (patch.missionLong !== undefined) update.missionLong = patch.missionLong
  if (patch.archivedAt !== undefined)  update.archivedAt = patch.archivedAt

  const [row] = await db
    .update(dominions)
    .set(update)
    .where(and(eq(dominions.id, id), eq(dominions.userId, userId)))
    .returning()
  return row ?? null
}

export async function deleteDominion(id: string, userId: string) {
  const [deleted] = await db
    .delete(dominions)
    .where(and(eq(dominions.id, id), eq(dominions.userId, userId)))
    .returning({ id: dominions.id })
  return !!deleted
}

export async function listDominionRepos(dominionId: string, userId: string): Promise<string[]> {
  const owned = await findDominionById(dominionId, userId)
  if (!owned) return []

  const rows = await db
    .select({ repoSlug: dominionRepos.repoSlug })
    .from(dominionRepos)
    .where(eq(dominionRepos.dominionId, dominionId))
  return rows.map((r) => r.repoSlug)
}

export async function addDominionRepo(dominionId: string, userId: string, repoSlug: string) {
  const owned = await findDominionById(dominionId, userId)
  if (!owned) return null

  const [row] = await db
    .insert(dominionRepos)
    .values({ dominionId, repoSlug })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

export async function removeDominionRepo(dominionId: string, userId: string, repoSlug: string): Promise<boolean> {
  const owned = await findDominionById(dominionId, userId)
  if (!owned) return false

  const [deleted] = await db
    .delete(dominionRepos)
    .where(and(eq(dominionRepos.dominionId, dominionId), eq(dominionRepos.repoSlug, repoSlug)))
    .returning({ dominionId: dominionRepos.dominionId })
  return !!deleted
}

export async function resolveDominionByRepo(userId: string, repoSlug: string): Promise<string | null> {
  const [row] = await db
    .select({ dominionId: dominionRepos.dominionId })
    .from(dominionRepos)
    .innerJoin(dominions, and(
      eq(dominionRepos.dominionId, dominions.id),
      eq(dominions.userId, userId),
    ))
    .where(eq(dominionRepos.repoSlug, repoSlug))
    .limit(1)
  return row?.dominionId ?? null
}

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (C12) — Dominion objectives + inspection briefing.
// ─────────────────────────────────────────────────────────────────────────

export async function listDominionObjectives(
  dominionId: string,
  userId: string,
  opts: { includeArchived?: boolean } = {}
) {
  const owned = await findDominionById(dominionId, userId)
  if (!owned) return []

  const baseFilter = eq(dominionObjectives.dominionId, dominionId)
  const where = opts.includeArchived
    ? baseFilter
    : and(baseFilter, isNull(dominionObjectives.archivedAt))

  return db
    .select()
    .from(dominionObjectives)
    .where(where)
    .orderBy(asc(dominionObjectives.sortOrder), asc(dominionObjectives.createdAt))
}

export async function createDominionObjective(userId: string, input: CreateDominionObjectiveInput) {
  const owned = await findDominionById(input.dominionId, userId)
  if (!owned) return null

  const [row] = await db
    .insert(dominionObjectives)
    .values({
      dominionId: input.dominionId,
      userId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'active',
      targetDate: input.targetDate ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning()
  return row
}

export async function updateDominionObjective(
  id: string,
  userId: string,
  patch: UpdateDominionObjectiveInput
) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined)       update.title = patch.title
  if (patch.description !== undefined) update.description = patch.description
  if (patch.status !== undefined)      update.status = patch.status
  if (patch.targetDate !== undefined)  update.targetDate = patch.targetDate
  if (patch.sortOrder !== undefined)   update.sortOrder = patch.sortOrder
  if (patch.archivedAt !== undefined)  update.archivedAt = patch.archivedAt

  const [row] = await db
    .update(dominionObjectives)
    .set(update)
    .where(and(eq(dominionObjectives.id, id), eq(dominionObjectives.userId, userId)))
    .returning()
  return row ?? null
}

export async function archiveDominionObjective(id: string, userId: string) {
  return updateDominionObjective(id, userId, { archivedAt: new Date() })
}

export async function deleteDominionObjective(id: string, userId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(dominionObjectives)
    .where(and(eq(dominionObjectives.id, id), eq(dominionObjectives.userId, userId)))
    .returning({ id: dominionObjectives.id })
  return !!deleted
}

// One-shot briefing query for the Briefer (E20) and the inspect_dominion MCP
// tool. Returns vision + mission + open objectives + projects + recent
// memories scoped to the Dominion. Memory recency is capped at `memoryLimit`
// (default 25) to keep the briefing context tight.
export async function inspectDominion(
  id: string,
  userId: string,
  opts: { memoryLimit?: number; boardTaskLimit?: number } = {}
) {
  const dominion = await findDominionById(id, userId)
  if (!dominion) return null

  const memoryLimit = Math.min(Math.max(opts.memoryLimit ?? 25, 1), 200)
  const boardLimit = Math.min(Math.max(opts.boardTaskLimit ?? 20, 1), 100)

  // Kairos Phase 2 (A3) — live board awareness. The Briefer needs to see open
  // cards on the Dominion's projects so it can flag "you put 'finish DB
  // migration' on AS Sprint yesterday — still untouched" the next morning.
  // Priority sort puts high/urgent first, then in_progress before todo.
  const priorityOrder = sql<number>`
    CASE ${boardTasks.priority}
      WHEN 'urgent' THEN 1
      WHEN 'high'   THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low'    THEN 4
      ELSE 5
    END`
  const statusOrder = sql<number>`
    CASE ${boardTasks.status}
      WHEN 'in_progress' THEN 1
      WHEN 'blocked'     THEN 2
      WHEN 'todo'        THEN 3
      ELSE 4
    END`

  const [objectiveRows, projectRows, repoRows, memoryRows, boardTaskRows] = await Promise.all([
    db
      .select()
      .from(dominionObjectives)
      .where(and(
        eq(dominionObjectives.dominionId, id),
        isNull(dominionObjectives.archivedAt),
      ))
      .orderBy(asc(dominionObjectives.sortOrder), asc(dominionObjectives.createdAt)),
    db
      .select({
        id: projects.id,
        name: projects.name,
      })
      .from(projects)
      .where(and(eq(projects.dominionId, id), eq(projects.userId, userId)))
      .orderBy(asc(projects.name)),
    db
      .select({ repoSlug: dominionRepos.repoSlug })
      .from(dominionRepos)
      .where(eq(dominionRepos.dominionId, id)),
    db
      .select({
        id: memories.id,
        title: memories.title,
        type: memories.type,
        source: memories.source,
        pinned: memories.pinned,
        createdAt: memories.createdAt,
        summary: memories.summary,
      })
      .from(memories)
      // Kairos Phase 2 (B1+B2) — exclude synthesised rows (archetypes,
      // cortex docs) from the briefing's "recent memories" stream. Those
      // are Kairos's own output and feeding them back in causes a
      // recursive context-collapse loop where the Briefer reasons over
      // yesterday's reasoning. The cortex is loaded explicitly elsewhere
      // when callers need it; archetypes surface via their own panel.
      .where(and(
        eq(memories.dominionId, id),
        eq(memories.userId, userId),
        isNull(memories.archivedAt),
        ne(memories.streamClass, 'archetype'),
        ne(memories.streamClass, 'cortex'),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(memoryLimit),
    db
      .select({
        id: boardTasks.id,
        name: boardTasks.name,
        status: boardTasks.status,
        priority: boardTasks.priority,
        projectName: projects.name,
        startDate: boardTasks.startDate,
        endDate: boardTasks.endDate,
        updatedAt: boardTasks.updatedAt,
      })
      .from(boardTasks)
      .innerJoin(projects, eq(boardTasks.projectId, projects.id))
      .where(and(
        eq(projects.dominionId, id),
        eq(projects.userId, userId),
        isNull(boardTasks.archivedAt),
        isNull(boardTasks.completedAt),
      ))
      .orderBy(priorityOrder, statusOrder, desc(boardTasks.updatedAt))
      .limit(boardLimit),
  ])

  return {
    id: dominion.id,
    name: dominion.name,
    color: dominion.color,
    icon: dominion.icon,
    vision: dominion.vision,
    missionLong: dominion.missionLong,
    archivedAt: dominion.archivedAt,
    createdAt: dominion.createdAt,
    updatedAt: dominion.updatedAt,
    objectives: objectiveRows,
    projects: projectRows,
    repos: repoRows.map((r) => r.repoSlug),
    recentMemories: memoryRows,
    boardTasks: boardTaskRows,
  }
}

export async function resolveDominionForMemory(
  userId: string,
  opts: { dominionId?: string | null; projectId?: string | null; sourceMetadata?: Record<string, unknown> | null }
): Promise<string | null> {
  if (opts.dominionId) return opts.dominionId

  if (opts.projectId) {
    const [proj] = await db
      .select({ dominionId: projects.dominionId })
      .from(projects)
      .where(and(eq(projects.id, opts.projectId), eq(projects.userId, userId)))
      .limit(1)
    if (proj?.dominionId) return proj.dominionId
  }

  if (typeof opts.sourceMetadata?.repo === 'string') {
    const resolved = await resolveDominionByRepo(userId, opts.sourceMetadata.repo)
    if (resolved) return resolved
  }

  return null
}
