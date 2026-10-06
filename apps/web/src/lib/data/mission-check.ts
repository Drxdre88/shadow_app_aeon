import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, boardTasks, projects } from '@/lib/db/schema'
import { MISSION_CHECK_SETTING, isMissionCheckOn, type MissionCheck } from '@/lib/kairos/mission-check/types'
import { canEditProject } from './hangar-access'

// Mission check ("Vorath checks finished missions"): the per-board switch in
// projects.settings.kairosMissionCheck and the advisory verdict in
// board_tasks.metadata.hangar.check. Pure queries plus the one guarded write;
// the verdict never touches a card's column, status or checklist.

const switchOnSql = sql`(${projects.settings} -> ${MISSION_CHECK_SETTING}) = 'true'::jsonb`
const latestSessionSql = sql`(${boardTasks.metadata} -> 'hangar' -> 'sessionIds' ->> -1)`

/**
 * Switch mission checks on or off for a board its owner created. Scoped to
 * projects.user_id = ownerUserId so a member, even a realm owner, can't flip
 * it on someone else's board. Other settings keys survive.
 */
export async function setProjectMissionCheck(projectId: string, ownerUserId: string, on: boolean) {
  const settings = on
    ? sql`coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify({ [MISSION_CHECK_SETTING]: true })}::jsonb`
    : sql`coalesce(${projects.settings}, '{}'::jsonb) - ${MISSION_CHECK_SETTING}`
  const [project] = await db
    .update(projects)
    .set({ settings, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, ownerUserId)))
    .returning({ id: projects.id, settings: projects.settings })
  return project ?? null
}

/** Owner and settings of one board, for the switch. */
export async function findMissionCheckBoard(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, userId: projects.userId, settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

export interface MissionCheckCandidate {
  sessionId: string
  taskId: string
  projectId: string
  engine: string
  repo: string | null
  endedAt: Date | null
  cardName: string
  description: string | null
  cardMetadata: unknown
}

/**
 * This user's missions worth a verdict, newest first: succeeded, card-anchored,
 * ended since `since`, on a board with the switch on, the card's latest
 * result is a completed non-plan run from this very session, and no verdict
 * for this session is on the card yet.
 */
export async function listMissionCheckCandidates(userId: string, since: Date, limit = 5): Promise<MissionCheckCandidate[]> {
  return db
    .select({
      sessionId: agentSessions.id,
      taskId: boardTasks.id,
      projectId: boardTasks.projectId,
      engine: agentSessions.engine,
      repo: agentSessions.repo,
      endedAt: agentSessions.endedAt,
      cardName: boardTasks.name,
      description: boardTasks.description,
      cardMetadata: boardTasks.metadata,
    })
    .from(agentSessions)
    .innerJoin(boardTasks, eq(boardTasks.id, agentSessions.taskId))
    .innerJoin(projects, eq(projects.id, boardTasks.projectId))
    .where(and(
      eq(agentSessions.userId, userId),
      eq(agentSessions.status, 'succeeded'),
      isNotNull(agentSessions.taskId),
      gte(agentSessions.endedAt, since),
      isNull(boardTasks.archivedAt),
      switchOnSql,
      sql`coalesce(${agentSessions.metadata} -> 'hangar' ->> 'phase', '') <> 'plan'`,
      sql`(${boardTasks.metadata} -> 'hangar' -> 'lastResult' ->> 'status') = 'completed'`,
      sql`${latestSessionSql} = ${agentSessions.id}::text`,
      sql`(${boardTasks.metadata} -> 'hangar' -> 'check' ->> 'sessionId') is distinct from ${agentSessions.id}::text`,
    ))
    .orderBy(desc(agentSessions.endedAt))
    .limit(limit)
}

export type MissionCheckWrite = 'written' | 'switched_off' | 'denied' | 'stale'

/**
 * Store the verdict on the card, in one transaction: the board's switch is
 * re-read, the session owner must still edit the board, and the card must
 * still show this session's result. Only metadata.hangar.check changes.
 */
export async function writeMissionCheck(
  input: { projectId: string; taskId: string; userId: string; check: MissionCheck },
): Promise<MissionCheckWrite> {
  const { projectId, taskId, userId, check } = input
  return db.transaction(async (tx) => {
    const [board] = await tx
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!board || !isMissionCheckOn(board.settings)) return 'switched_off'
    if (!(await canEditProject(projectId, userId))) return 'denied'
    const rows = await tx
      .update(boardTasks)
      .set({ metadata: sql`jsonb_set(coalesce(${boardTasks.metadata}, '{}'::jsonb), '{hangar,check}', ${JSON.stringify(check)}::jsonb, true)` })
      .where(and(
        eq(boardTasks.id, taskId),
        eq(boardTasks.projectId, projectId),
        sql`${latestSessionSql} = ${check.sessionId}`,
      ))
      .returning({ id: boardTasks.id })
    return rows.length > 0 ? 'written' : 'stale'
  })
}
