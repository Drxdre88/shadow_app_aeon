import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentSessions, type AgentSession } from '@/lib/db/schema'

// Owner-initiated kill, shared by the app (server action), MCP kill_session and
// REST POST /sessions/:id/kill. Stamps metadata.kill so payback can tell a kill
// the owner asked for from a runner that died; a later worker status PATCH may
// overwrite status, but metadata.kill survives.

export type SessionKillVia = 'app' | 'mcp' | 'rest'

export interface SessionKillStamp {
  by: 'owner'
  via: SessionKillVia
  at: string
  reason?: string
}

export interface OwnerKillOptions {
  reason?: string
  now?: Date
  // The app only asks the worker host when the session has a worker pid.
  workerPidRequired?: boolean
}

/** Best-effort SIGTERM through the worker host; true when it acknowledged. */
export async function requestWorkerKill(sessionId: string): Promise<boolean> {
  const workerUrl = process.env.KAIROS_WORKER_URL
  if (!workerUrl) return false
  const workerSecret = process.env.KAIROS_WORKER_SECRET
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/kill/${sessionId}`, {
      method: 'POST',
      headers: workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {},
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch (err) {
    console.error('[sessions/kill] worker kill failed', err)
    return false
  }
}

export function ownerKillStamp(via: SessionKillVia, now: Date, reason?: string): SessionKillStamp {
  return { by: 'owner', via, at: now.toISOString(), ...(reason ? { reason } : {}) }
}

/** Marks the caller's session killed and records that the owner asked for it. */
export async function markSessionKilledByOwner(id: string, userId: string, via: SessionKillVia, options: OwnerKillOptions = {}) {
  const now = options.now ?? new Date()
  const stamp = ownerKillStamp(via, now, options.reason)
  const [row] = await db
    .update(agentSessions)
    .set({
      status: 'killed',
      endedAt: now,
      updatedAt: now,
      metadata: sql`jsonb_set(coalesce(${agentSessions.metadata}, '{}'::jsonb), '{kill}', ${JSON.stringify(stamp)}::jsonb, true)`,
    })
    .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, userId)))
    .returning()
  return row ?? null
}

/** Asks the worker to stop the process, then marks the row killed regardless of the worker's answer. */
export async function killSessionByOwner(
  session: Pick<AgentSession, 'id' | 'workerPid'>,
  userId: string,
  via: SessionKillVia,
  options: OwnerKillOptions = {},
) {
  const askWorker = !options.workerPidRequired || Boolean(session.workerPid)
  const workerAck = askWorker ? await requestWorkerKill(session.id) : false
  const row = await markSessionKilledByOwner(session.id, userId, via, options)
  return { row, workerAck }
}
