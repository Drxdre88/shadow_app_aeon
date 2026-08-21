'use server'

import { requireAuth } from './helpers'
import {
  spawnSessionSchema,
  updateSessionStatusSchema,
  recordSessionEventSchema,
  listSessionsSchema,
  type SpawnSessionInput,
  type UpdateSessionStatusInput,
  type RecordSessionEventInput,
  type ListSessionsInput,
} from '@/lib/data/validators'
import {
  createAgentSession,
  findAgentSessionById,
  listAgentSessions,
  updateAgentSessionStatus,
  recordSessionEvent as _recordSessionEvent,
  listSessionEvents as _listSessionEvents,
  getNextEventSeq,
} from '@/lib/data/sessions'
import { dispatchSpawn } from '@/lib/kairos/spawn'

// Spawn a new agent session. Creates the row, then asks the worker host to
// shell the CLI. If the worker isn't reachable the row stays in 'queued' and
// the operator can retry — nothing else breaks.
export async function spawnSessionAction(input: SpawnSessionInput) {
  const userId = await requireAuth()
  const parsed = spawnSessionSchema.parse(input)

  const session = await createAgentSession(userId, parsed)

  const callbackBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.AEON_BASE_URL || ''
  const callbackToken = process.env.AEON_API_KEY || ''

  const result = await dispatchSpawn({
    sessionId: session.id,
    engine: session.engine,
    repo: session.repo,
    branch: session.branch,
    goal: session.goal,
    prompt: session.prompt,
    callbackToken,
    callbackBaseUrl,
  })

  if (result.dispatched) {
    await updateAgentSessionStatus(session.id, userId, {
      status: 'running',
      workerHost: result.workerHost,
      startedAt: new Date(),
    })
  } else {
    await _recordSessionEvent(session.id, {
      seq: 0,
      kind: 'status',
      payload: { dispatched: false, reason: result.reason },
    })
  }

  return findAgentSessionById(session.id, userId)
}

export async function getSessionAction(id: string) {
  const userId = await requireAuth()
  const row = await findAgentSessionById(id, userId)
  if (!row) throw new Error('Session not found or unauthorized')
  return row
}

export async function listSessionsAction(input: ListSessionsInput = { liveOnly: false, limit: 20, offset: 0 }) {
  const userId = await requireAuth()
  const parsed = listSessionsSchema.parse(input)
  return listAgentSessions(userId, parsed)
}

export async function updateSessionStatusAction(id: string, patch: UpdateSessionStatusInput) {
  const userId = await requireAuth()
  const parsed = updateSessionStatusSchema.parse(patch)
  const row = await updateAgentSessionStatus(id, userId, parsed)
  if (!row) throw new Error('Session not found or unauthorized')
  return row
}

export async function recordSessionEventAction(id: string, input: RecordSessionEventInput) {
  const userId = await requireAuth()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  const parsed = recordSessionEventSchema.parse(input)
  return _recordSessionEvent(id, parsed)
}

export async function getNextEventSeqAction(id: string) {
  const userId = await requireAuth()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  return getNextEventSeq(id)
}

export async function listSessionEventsAction(id: string, opts: { limit?: number; afterSeq?: number; tail?: boolean } = {}) {
  const userId = await requireAuth()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  return _listSessionEvents(id, opts)
}

export async function killSessionAction(id: string) {
  const userId = await requireAuth()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')

  const workerUrl = process.env.KAIROS_WORKER_URL
  const workerSecret = process.env.KAIROS_WORKER_SECRET
  if (workerUrl && session.workerPid) {
    try {
      await fetch(`${workerUrl.replace(/\/$/, '')}/kill/${session.id}`, {
        method: 'POST',
        headers: workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {},
        signal: AbortSignal.timeout(5_000),
      })
    } catch (err) {
      console.error('[sessions/kill] worker kill failed', err)
    }
  }

  return updateAgentSessionStatus(id, userId, { status: 'killed', endedAt: new Date() })
}
