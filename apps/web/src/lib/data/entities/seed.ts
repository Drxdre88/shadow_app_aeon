import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  dominionRepos, dominions, entities, entityAliases, groupMembers, hangarRepos, labels,
  memberProfiles, projectGroups, projectMembers, projects, users, virtualMembers,
} from '@/lib/db/schema'
import { notArchivedSql } from '@/lib/data/board-visibility'
import { normAlias } from './normalize'
import { buildSeedPlan, type SeedSources } from './seed-plan'

export interface SeedResult {
  entities: number
  aliases: number
}

async function userRealmIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId))
  return rows.map((r) => r.id)
}

async function accessibleProjects(userId: string, realmIds: string[]) {
  const viaRealm = realmIds.length > 0
    ? sql`EXISTS (SELECT 1 FROM ${projectGroups} WHERE ${projectGroups.projectId} = ${projects.id} AND ${inArray(projectGroups.groupId, realmIds)})`
    : sql`FALSE`
  const viaMember = sql`EXISTS (SELECT 1 FROM ${projectMembers} WHERE ${projectMembers.projectId} = ${projects.id} AND ${projectMembers.userId} = ${userId})`
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(or(eq(projects.userId, userId), viaMember, viaRealm), notArchivedSql))
}

export async function loadSeedSources(userId: string): Promise<SeedSources> {
  const realmIds = await userRealmIds(userId)
  const inRealms = <T>(run: () => Promise<T[]>) => (realmIds.length > 0 ? run() : Promise.resolve([] as T[]))
  const projectRows = await accessibleProjects(userId, realmIds)
  const projectIds = projectRows.map((p) => p.id)
  const [doms, labelRows, repoRows, hangarRows, memberRows, profileRows, virtualRows] = await Promise.all([
    db.select({ id: dominions.id, name: dominions.name }).from(dominions)
      .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt))),
    projectIds.length > 0
      ? db.select({ id: labels.id, name: labels.name }).from(labels)
        .where(and(inArray(labels.projectId, projectIds), sql`(${labels.name} ILIKE 'repo:%' OR ${labels.name} ILIKE 'dom:%')`))
      : Promise.resolve([]),
    db.select({ repoSlug: dominionRepos.repoSlug }).from(dominionRepos)
      .innerJoin(dominions, eq(dominions.id, dominionRepos.dominionId))
      .where(eq(dominions.userId, userId)),
    inRealms(() => db.select({ id: hangarRepos.id, slug: hangarRepos.slug, name: hangarRepos.name, ghSlug: hangarRepos.ghSlug })
      .from(hangarRepos).where(inArray(hangarRepos.realmId, realmIds))),
    inRealms(() => db.selectDistinct({ id: users.id, name: users.name }).from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId)).where(inArray(groupMembers.groupId, realmIds))),
    inRealms(() => db.select({ userId: memberProfiles.userId, displayName: memberProfiles.displayName })
      .from(memberProfiles).where(inArray(memberProfiles.realmId, realmIds))),
    inRealms(() => db.select({ id: virtualMembers.id, name: virtualMembers.name })
      .from(virtualMembers).where(inArray(virtualMembers.realmId, realmIds))),
  ])
  return {
    dominions: doms,
    projects: projectRows,
    labels: labelRows,
    dominionRepos: repoRows,
    hangarRepos: hangarRows,
    members: memberRows,
    memberProfiles: profileRows,
    virtualMembers: virtualRows,
  }
}

// Idempotent: entities upsert on (user, kind, norm_name) and only refresh rows
// the seed owns; aliases insert-or-skip. Nothing is ever deleted here.
export async function seedEntities(userId: string): Promise<SeedResult> {
  const plan = buildSeedPlan(await loadSeedSources(userId))
  if (plan.length === 0) return { entities: 0, aliases: 0 }
  return db.transaction(async (tx) => {
    await tx
      .insert(entities)
      .values(plan.map((e) => ({
        userId, kind: e.kind, name: e.name, normName: e.normName, refKind: e.refKind, refId: e.refId, source: 'seed',
      })))
      .onConflictDoUpdate({
        target: [entities.userId, entities.kind, entities.normName],
        set: { name: sql`excluded.name`, refKind: sql`excluded.ref_kind`, refId: sql`excluded.ref_id`, updatedAt: sql`now()` },
        setWhere: sql`${entities.source} = 'seed'`,
      })
    const rows = await tx
      .select({ id: entities.id, kind: entities.kind, normName: entities.normName })
      .from(entities)
      .where(eq(entities.userId, userId))
    const idOf = new Map(rows.map((r) => [`${r.kind}:${r.normName}`, r.id]))
    const aliasRows = plan.flatMap((e) => {
      const entityId = idOf.get(`${e.kind}:${e.normName}`)
      return entityId ? e.aliases.map((alias) => ({ entityId, userId, alias, aliasNorm: normAlias(alias), source: 'seed' })) : []
    })
    const inserted = aliasRows.length > 0
      ? await tx.insert(entityAliases).values(aliasRows).onConflictDoNothing().returning({ id: entityAliases.id })
      : []
    return { entities: plan.length, aliases: inserted.length }
  })
}
