import { db } from '@/lib/db'
import { dominions, dominionRepos, projects } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import type { CreateDominionInput, UpdateDominionInput } from './validators'

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
    })
    .returning()
  return row
}

export async function updateDominion(id: string, userId: string, patch: UpdateDominionInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name !== undefined)      update.name = patch.name
  if (patch.color !== undefined)     update.color = patch.color
  if (patch.icon !== undefined)      update.icon = patch.icon
  if (patch.sortOrder !== undefined) update.sortOrder = patch.sortOrder

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
