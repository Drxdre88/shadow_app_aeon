import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { archivedSql, notArchivedSql } from './board-visibility'
import {
  PROJECT_ARCHIVED_AT_SETTING,
  PROJECT_ARCHIVED_SETTING,
  projectArchivedAt,
  type ArchivedProjectView,
} from '@/lib/projects/archive'

// The board Archive switch (projects.settings.archived / archivedAt). An
// archived board leaves every list surface and Vorath's live inputs for all
// members; reads by explicit id keep working. Pure queries — guards live in
// lib/actions/project-archive.ts.

export { notArchivedSql }

/**
 * Archive or restore a board its creator made. Scoped to projects.user_id =
 * ownerUserId, so no member or realm owner of a shared board can flip it.
 * Restore removes both keys; other settings keys survive. Null when no row matched.
 */
export async function setProjectArchivedForOwner(
  projectId: string,
  ownerUserId: string,
  archived: boolean,
): Promise<{ id: string; settings: unknown } | null> {
  const settings = archived
    ? sql`coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify({
      [PROJECT_ARCHIVED_SETTING]: true,
      [PROJECT_ARCHIVED_AT_SETTING]: new Date().toISOString(),
    })}::jsonb`
    : sql`coalesce(${projects.settings}, '{}'::jsonb) - 'archived' - 'archivedAt'`
  const [project] = await db
    .update(projects)
    .set({ settings, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, ownerUserId)))
    .returning({ id: projects.id, settings: projects.settings })
  return project ?? null
}

/** Owner and settings of one board, for the switch's state. */
export async function findProjectArchiveInfo(
  projectId: string,
): Promise<{ id: string; userId: string; settings: unknown } | null> {
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId, settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

/** Archived boards this user created, most recently archived first. */
export async function findArchivedProjects(userId: string): Promise<ArchivedProjectView[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, settings: projects.settings })
    .from(projects)
    .where(and(eq(projects.userId, userId), archivedSql))
    .orderBy(sql`(${projects.settings} ->> 'archivedAt') desc nulls last`, desc(projects.updatedAt))
  return rows.map((r) => ({ id: r.id, name: r.name, archivedAt: projectArchivedAt(r.settings) }))
}
