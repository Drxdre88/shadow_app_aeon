import { db } from '@/lib/db'
import { agentSessions, sessionEvents } from '@/lib/db/schema'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import type {
  SpawnSessionInput,
  UpdateSessionStatusInput,
  RecordSessionEventInput,
  ListSessionsInput,
  AgentSessionStatus,
} from './validators'

const LIVE_STATUSES: AgentSessionStatus[] = ['queued', 'running']

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
