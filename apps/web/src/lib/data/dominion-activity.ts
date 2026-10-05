import { db } from '@/lib/db'
import { activityEvents, dominionMembers, dominionRepos, dominions, memories, projects, userPreferences } from '@/lib/db/schema'
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { dormantAfterDays } from '@/lib/kairos/living/flag'
import { LIVING_UNATTRIBUTED_PREF_KEY, type UnattributedActivity } from '@/lib/kairos/living/types'
import { classifyMemory, WINDOW_DAYS, type MemorySignalRow } from '@/lib/kairos/living/signals'
import { scoreActivity, type ActivityInputs, type ActivityResult, type NoteSignal, type SessionSignal } from '@/lib/kairos/living/score'

// Living Dominions nightly activity (living_dominions.md §2 A). Reads one
// user's raw signals for the last 30 days, scores them with the pure scorer
// and writes every result for that user in one transaction.
// Caveats from the live data: finished cards are vaulted off boards, so
// completions come from activity_events, not board_tasks.completed_at; and
// agent-tool events carry the owner's actor_id, so work is the user's when
// actor_id is theirs (or unattributed by actor on a board they own).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DominionActivityRun = {
  userId: string
  scored: number
  dormant: number
  unattributedBoards: number
  unattributedRepos: number
}

const DAY_MS = 86_400_000

export async function listDominionActivityUserIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: dominions.userId }).from(dominions).where(isNull(dominions.archivedAt))
  return rows.map((r) => r.userId)
}

type Handle = Tx | typeof db

export function readLiveDominions(userId: string, h: Handle = db) {
  return h
    .select({ id: dominions.id, createdAt: dominions.createdAt, lastActiveAt: dominions.lastActiveAt, pinned: dominions.pinned })
    .from(dominions)
    .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt)))
}

// Card events the user made (directly or through an agent tool) on any board,
// plus actor-less events on boards they own.
export function readCardEvents(userId: string, since: Date, h: Handle = db) {
  return h
    .select({
      boardId: activityEvents.projectId,
      boardName: projects.name,
      boardDominionId: projects.dominionId,
      entityType: activityEvents.entityType,
      action: activityEvents.action,
      actorType: activityEvents.actorType,
      at: activityEvents.createdAt,
    })
    .from(activityEvents)
    .innerJoin(projects, eq(projects.id, activityEvents.projectId))
    .where(and(
      gte(activityEvents.createdAt, since),
      or(eq(activityEvents.actorId, userId), and(isNull(activityEvents.actorId), eq(projects.userId, userId))),
    ))
}

export function readActiveMembers(userId: string, h: Handle = db) {
  return h
    .select({
      id: dominionMembers.id,
      kind: dominionMembers.kind,
      ref: dominionMembers.ref,
      dominionId: dominionMembers.dominionId,
      weight: dominionMembers.weight,
    })
    .from(dominionMembers)
    .where(and(
      eq(dominionMembers.userId, userId),
      eq(dominionMembers.status, 'active'),
      inArray(dominionMembers.kind, ['board', 'repo']),
    ))
}

export function readRepoMappings(userId: string, h: Handle = db) {
  return h
    .select({ dominionId: dominionRepos.dominionId, repoSlug: dominionRepos.repoSlug })
    .from(dominionRepos)
    .innerJoin(dominions, eq(dominions.id, dominionRepos.dominionId))
    .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt)))
}

// Candidate session summaries and hand-written notes; classifyMemory decides.
export function readMemorySignals(userId: string, since: Date, h: Handle = db) {
  return h
    .select({
      type: memories.type,
      source: memories.source,
      originKind: sql<string | null>`${memories.sourceMetadata}->'origin'->>'kind'`,
      metaKind: sql<string | null>`${memories.sourceMetadata}->>'kind'`,
      repo: sql<string | null>`${memories.sourceMetadata}->>'repo'`,
      dominionId: memories.dominionId,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      gte(memories.createdAt, since),
      or(
        eq(memories.type, 'session_summary'),
        inArray(memories.source, ['manual', 'voice']),
        sql`${memories.sourceMetadata}->'origin'->>'kind' = 'operator'`,
      ),
    ))
}

type CardEventRow = Awaited<ReturnType<typeof readCardEvents>>[number]

export function buildActivityInputs(
  now: Date,
  parts: Pick<ActivityInputs, 'dominions' | 'members' | 'repoMappings'> & { events: readonly CardEventRow[]; memoryRows: readonly MemorySignalRow[] },
): ActivityInputs {
  const boards = new Map<string, ActivityInputs['boards'][number]>()
  for (const e of parts.events) boards.set(e.boardId, { id: e.boardId, name: e.boardName, dominionId: e.boardDominionId })

  const sessions: SessionSignal[] = []
  const notes: NoteSignal[] = []
  for (const row of parts.memoryRows) {
    const signal = classifyMemory(row)
    if (signal?.kind === 'session') sessions.push({ repo: signal.repo, at: signal.at })
    else if (signal?.kind === 'note') notes.push({ dominionId: signal.dominionId, at: signal.at })
  }

  return {
    now,
    dormantDays: dormantAfterDays(),
    dominions: parts.dominions,
    boards: [...boards.values()],
    members: parts.members,
    repoMappings: parts.repoMappings,
    cardEvents: parts.events.map(({ boardId, entityType, action, actorType, at }) => ({ boardId, entityType, action, actorType, at })),
    sessions,
    notes,
  }
}

export async function loadActivityInputs(userId: string, now: Date): Promise<ActivityInputs> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  const [liveDominions, events, members, repoMappings, memoryRows] = await Promise.all([
    readLiveDominions(userId),
    readCardEvents(userId, since),
    readActiveMembers(userId),
    readRepoMappings(userId),
    readMemorySignals(userId, since),
  ])
  return buildActivityInputs(now, { dominions: liveDominions, events, members, repoMappings, memoryRows })
}

const ts = (d: Date) => sql`${d.toISOString()}::timestamp`

const mergePref = (value: UnattributedActivity) =>
  sql`${userPreferences.preferences} || jsonb_build_object(${LIVING_UNATTRIBUTED_PREF_KEY}::text, ${JSON.stringify(value)}::jsonb)`

// Same jsonb merge of just this key as kairos-gate, as one upsert: other
// preference keys are never overwritten.
async function writeUnattributed(tx: Tx, userId: string, value: UnattributedActivity): Promise<void> {
  const updatedAt = new Date()
  await tx
    .insert(userPreferences)
    .values({ userId, preferences: { [LIVING_UNATTRIBUTED_PREF_KEY]: value }, updatedAt })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { preferences: mergePref(value), updatedAt } })
}

// One transaction per user. lastActiveAt and last_signal_at only move forward
// (GREATEST ignores NULL); a pinned Dominion always stays 'active', even if it
// was pinned after the signals were read. pinned itself is never written.
export async function writeActivityResult(userId: string, result: ActivityResult): Promise<void> {
  await db.transaction(async (tx) => {
    for (const d of result.dominions) {
      await tx
        .update(dominions)
        .set({
          activityScore: d.score,
          activityScoredAt: result.scoredAt,
          activity: d.activity,
          ...(d.lastActiveAt ? { lastActiveAt: sql`GREATEST(${dominions.lastActiveAt}, ${ts(d.lastActiveAt)})` } : {}),
          focusState: sql`CASE WHEN ${dominions.pinned} THEN 'active' ELSE ${d.focusState} END`,
        })
        .where(and(eq(dominions.id, d.dominionId), eq(dominions.userId, userId)))
    }
    for (const m of result.memberSignals) {
      await tx
        .update(dominionMembers)
        .set({ lastSignalAt: sql`GREATEST(${dominionMembers.lastSignalAt}, ${ts(m.at)})` })
        .where(and(eq(dominionMembers.id, m.memberId), eq(dominionMembers.userId, userId)))
    }
    await writeUnattributed(tx, userId, result.unattributed)
  })
}

export async function scoreDominionActivityForUser(userId: string, now: Date = new Date()): Promise<DominionActivityRun> {
  const result = scoreActivity(await loadActivityInputs(userId, now))
  await writeActivityResult(userId, result)
  return {
    userId,
    scored: result.dominions.length,
    dormant: result.dominions.filter((d) => d.focusState === 'dormant').length,
    unattributedBoards: result.unattributed.boards.length,
    unattributedRepos: result.unattributed.repos.length,
  }
}

function isUnattributed(v: unknown): v is UnattributedActivity {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.scoredAt === 'string' && Array.isArray(o.boards) && Array.isArray(o.repos)
}

export async function getUnattributedActivity(userId: string): Promise<UnattributedActivity | null> {
  const [row] = await db
    .select({ value: sql<unknown>`${userPreferences.preferences} -> ${LIVING_UNATTRIBUTED_PREF_KEY}::text` })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
  return isUnattributed(row?.value) ? row.value : null
}
