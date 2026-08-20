import { db } from '@/lib/db'
import { agentSessions, sessionEvents, boardTasks } from '@/lib/db/schema'
import { eq, and, asc, desc, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type {
  SpawnSessionInput,
  UpdateSessionStatusInput,
  RecordSessionEventInput,
  ListSessionsInput,
  AgentSessionStatus,
  HangarAgent,
  HangarResultEnvelope,
  UpdateTaskInput,
} from './validators'
import { findColumns } from './columns'
import { findProjectSettings } from './projects'
import { updateTask } from './tasks'

const LIVE_STATUSES: AgentSessionStatus[] = ['queued', 'running']
const TERMINAL_STATUSES: AgentSessionStatus[] = ['succeeded', 'failed', 'killed', 'timeout']
const CLAIMABLE_ENGINES: HangarAgent[] = ['claude', 'codex', 'copilot']

// Hangar lifecycle columns a finished mission lands in. Failures stay put so a
// human triages them where they were launched.
const RESULT_COLUMN_NAMES: Record<HangarResultEnvelope['status'], string | null> = {
  completed: 'Landing',
  needs_input: 'Tower',
  failed: null,
}

export async function createAgentSession(userId: string, input: SpawnSessionInput) {
  const [row] = await db
    .insert(agentSessions)
    .values({
      userId,
      engine: input.engine,
      goal: input.goal,
      prompt: input.prompt,
      repo: input.repo ?? null,
      branch: input.branch ?? null,
      projectId: input.projectId ?? null,
      realmId: input.realmId ?? null,
      dominionId: input.dominionId ?? null,
      taskId: input.taskId ?? null,
      metadata: input.metadata ?? {},
      status: 'queued',
    })
    .returning()
  return row
}

export async function findAgentSessionById(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function listAgentSessions(userId: string, input: ListSessionsInput) {
  const where = [eq(agentSessions.userId, userId)]

  if (input.liveOnly) {
    where.push(inArray(agentSessions.status, LIVE_STATUSES))
  } else if (input.status) {
    const statuses = Array.isArray(input.status) ? input.status : [input.status]
    if (statuses.length === 1) where.push(eq(agentSessions.status, statuses[0]))
    else where.push(inArray(agentSessions.status, statuses))
  }

  if (input.dominionId) where.push(eq(agentSessions.dominionId, input.dominionId))
  if (input.projectId) where.push(eq(agentSessions.projectId, input.projectId))
  // spawnedAt is covered by an index (see schema) — since-filtering stays index-backed.
  if (input.since) where.push(gte(agentSessions.spawnedAt, input.since))

  return db
    .select()
    .from(agentSessions)
    .where(and(...where))
    .orderBy(desc(agentSessions.spawnedAt))
    .limit(input.limit)
    .offset(input.offset)
}

export async function updateAgentSessionStatus(
  id: string,
  userId: string,
  patch: UpdateSessionStatusInput,
) {
  const update: Record<string, unknown> = { status: patch.status, updatedAt: new Date() }
  if (patch.workerHost !== undefined) update.workerHost = patch.workerHost
  if (patch.workerPid !== undefined) update.workerPid = patch.workerPid
  if (patch.exitCode !== undefined) update.exitCode = patch.exitCode
  if (patch.startedAt !== undefined) update.startedAt = patch.startedAt
  if (patch.endedAt !== undefined) update.endedAt = patch.endedAt
  if (patch.costUsd !== undefined) {
    // Drizzle's numeric column expects a string for precision-safe insertion.
    update.costUsd = patch.costUsd === null ? null : String(patch.costUsd)
  }

  const [row] = await db
    .update(agentSessions)
    .set(update)
    .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, userId)))
    .returning()
  return row ?? null
}

// Pull-mode dispatch. The runner polls; this hands it exactly one queued
// mission owned by the authenticated caller — a runner must never execute
// another user's prompt. taskId IS NOT NULL is mandatory — kairos-chat and
// dialogue threads live in this table too and must never be claimed. SKIP
// LOCKED lets several runners poll concurrently without blocking each other.
// Nothing but the lock and the update happens inside the transaction: the Neon
// pool times an acquire out at 8s, so a transaction that waits on anything
// else can strand the pool.
export async function claimNextSession(
  userId: string,
  workerId: string,
  engines: string[] = CLAIMABLE_ENGINES,
) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(
        eq(agentSessions.userId, userId),
        eq(agentSessions.status, 'queued'),
        isNotNull(agentSessions.taskId),
        inArray(agentSessions.engine, engines),
      ))
      .orderBy(asc(agentSessions.spawnedAt))
      .limit(1)
      .for('update', { skipLocked: true })

    if (!candidate) return null

    const now = new Date()
    const [row] = await tx
      .update(agentSessions)
      .set({
        status: 'running',
        claimedBy: workerId,
        claimedAt: now,
        lastHeartbeatAt: now,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(agentSessions.id, candidate.id))
      .returning()
    return row ?? null
  })
}

// Liveness ping from the runner that holds the claim. Returns null when the
// session was reassigned, killed or finished — the runner treats that as a
// cooperative stop signal.
export async function heartbeatSession(id: string, workerId: string) {
  const now = new Date()
  const [row] = await db
    .update(agentSessions)
    .set({ lastHeartbeatAt: now, updatedAt: now })
    .where(and(
      eq(agentSessions.id, id),
      eq(agentSessions.claimedBy, workerId),
      eq(agentSessions.status, 'running'),
    ))
    .returning()
  return row ?? null
}

async function resolveResultColumn(
  projectId: string,
  status: HangarResultEnvelope['status'],
): Promise<string | null> {
  const target = RESULT_COLUMN_NAMES[status]
  if (!target) return null

  const settings = await findProjectSettings(projectId)
  if (settings?.boardMode !== 'hangar') return null

  const columns = await findColumns(projectId)
  const match = columns.find((c) => c.name.trim().toLowerCase() === target.toLowerCase())
  return match?.id ?? null
}

// Terminal envelope handling: flip the session, cache the result on the card
// and move it along the Hangar lifecycle. needs_input still counts as a clean
// exit — the process finished, the mission is just waiting on a human.
export async function recordSessionResult(
  sessionId: string,
  envelope: HangarResultEnvelope,
) {
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
  if (!session) return null

  // Replay guard: a result envelope re-posted for an already-finished session
  // must not re-move the card or overwrite a triaged outcome.
  if (TERMINAL_STATUSES.includes(session.status as AgentSessionStatus)) {
    return { session, task: null }
  }

  const now = new Date()
  const [updatedSession] = await db
    .update(agentSessions)
    .set({
      status: envelope.status === 'failed' ? 'failed' : 'succeeded',
      endedAt: now,
      updatedAt: now,
    })
    .where(eq(agentSessions.id, sessionId))
    .returning()

  if (!session.taskId) return { session: updatedSession, task: null }

  const [task] = await db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.id, session.taskId))
    .limit(1)
  if (!task) return { session: updatedSession, task: null }

  const metadata = (task.metadata as Record<string, unknown>) ?? {}
  const hangar = (metadata.hangar as Record<string, unknown>) ?? {}
  const sessionIds = Array.isArray(hangar.sessionIds) ? (hangar.sessionIds as string[]) : []

  const patch: UpdateTaskInput = {
    metadata: {
      hangar: {
        ...hangar,
        lastResult: envelope,
        sessionIds: sessionIds.includes(sessionId) ? sessionIds : [...sessionIds, sessionId],
      },
    },
  }

  const columnId = await resolveResultColumn(task.projectId, envelope.status)
  if (columnId) patch.columnId = columnId

  const updatedTask = await updateTask(task.id, task.projectId, patch)
  return { session: updatedSession, task: updatedTask }
}

export async function attachSessionMemory(id: string, userId: string, memoryId: string) {
  const [row] = await db
    .update(agentSessions)
    .set({ memoryId, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, userId)))
    .returning()
  return row ?? null
}

// Worker / hook posting an event. seq is monotonic per session; the UNIQUE
// index on (session_id, seq) makes double-posts safe — we swallow conflicts.
export async function recordSessionEvent(
  sessionId: string,
  input: RecordSessionEventInput,
) {
  const [row] = await db
    .insert(sessionEvents)
    .values({
      sessionId,
      seq: input.seq,
      kind: input.kind,
      toolName: input.toolName ?? null,
      payload: input.payload ?? {},
    })
    .onConflictDoNothing({ target: [sessionEvents.sessionId, sessionEvents.seq] })
    .returning()
  return row ?? null
}

export async function listSessionEvents(
  sessionId: string,
  opts: { limit?: number; afterSeq?: number } = {},
) {
  const where = [eq(sessionEvents.sessionId, sessionId)]
  if (opts.afterSeq !== undefined) {
    where.push(sql`${sessionEvents.seq} > ${opts.afterSeq}`)
  }
  return db
    .select()
    .from(sessionEvents)
    .where(and(...where))
    .orderBy(sessionEvents.seq)
    .limit(opts.limit ?? 500)
}

export async function getNextEventSeq(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ maxSeq: sql<number | null>`MAX(${sessionEvents.seq})` })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
  return (row?.maxSeq ?? -1) + 1
}
