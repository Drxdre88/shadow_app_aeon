import { db } from '@/lib/db'
import { hangarRepos } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import type { CreateHangarRepoInput, UpdateHangarRepoInput } from './validators'

export async function createHangarRepo(input: CreateHangarRepoInput) {
  const [row] = await db
    .insert(hangarRepos)
    .values({
      realmId: input.realmId,
      slug: input.slug,
      name: input.name,
      gitUrl: input.gitUrl,
      ghSlug: input.ghSlug ?? null,
      defaultBranch: input.defaultBranch ?? 'main',
      branchPrefix: input.branchPrefix ?? 'aeon/',
      allowedEngines: input.allowedEngines ?? [],
      runCmd: input.runCmd ?? null,
      envSetupCmd: input.envSetupCmd ?? null,
      appUrl: input.appUrl ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? {},
    })
    .returning()
  return row
}

export async function listHangarRepos(realmId: string, opts: { activeOnly?: boolean } = {}) {
  const where = [eq(hangarRepos.realmId, realmId)]
  if (opts.activeOnly) where.push(eq(hangarRepos.active, true))

  return db
    .select()
    .from(hangarRepos)
    .where(and(...where))
    .orderBy(asc(hangarRepos.slug))
}

export async function findHangarRepoById(id: string) {
  const [row] = await db
    .select()
    .from(hangarRepos)
    .where(eq(hangarRepos.id, id))
    .limit(1)
  return row ?? null
}

export async function findHangarRepoBySlug(realmId: string, slug: string) {
  const [row] = await db
    .select()
    .from(hangarRepos)
    .where(and(eq(hangarRepos.realmId, realmId), eq(hangarRepos.slug, slug)))
    .limit(1)
  return row ?? null
}

export async function updateHangarRepo(id: string, patch: UpdateHangarRepoInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.slug !== undefined)           update.slug = patch.slug
  if (patch.name !== undefined)           update.name = patch.name
  if (patch.gitUrl !== undefined)         update.gitUrl = patch.gitUrl
  if (patch.ghSlug !== undefined)         update.ghSlug = patch.ghSlug
  if (patch.defaultBranch !== undefined)  update.defaultBranch = patch.defaultBranch
  if (patch.branchPrefix !== undefined)   update.branchPrefix = patch.branchPrefix
  if (patch.allowedEngines !== undefined) update.allowedEngines = patch.allowedEngines
  if (patch.runCmd !== undefined)         update.runCmd = patch.runCmd
  if (patch.envSetupCmd !== undefined)    update.envSetupCmd = patch.envSetupCmd
  if (patch.appUrl !== undefined)         update.appUrl = patch.appUrl
  if (patch.notes !== undefined)          update.notes = patch.notes
  if (patch.active !== undefined)         update.active = patch.active
  if (patch.metadata !== undefined)       update.metadata = patch.metadata

  const [row] = await db
    .update(hangarRepos)
    .set(update)
    .where(eq(hangarRepos.id, id))
    .returning()
  return row ?? null
}

export async function deleteHangarRepo(id: string) {
  const [deleted] = await db
    .delete(hangarRepos)
    .where(eq(hangarRepos.id, id))
    .returning({ id: hangarRepos.id })
  return !!deleted
}
