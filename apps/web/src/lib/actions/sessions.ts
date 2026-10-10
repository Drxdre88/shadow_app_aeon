'use server'

import { requireAuth, requireVorath, requireMemberAccess } from './helpers'
import { assertVorath, canUseVorath } from '@/lib/vorath-access'
import { z } from 'zod'
import {
  spawnSessionSchema,
  updateSessionStatusSchema,
  recordSessionEventSchema,
  listSessionsSchema,
  sessionEventsTailArgsSchema,
  type SessionEventsTailArgs,
  type SpawnSessionInput,
  type UpdateSessionStatusInput,
  type RecordSessionEventInput,
  type ListSessionsInput,
} from '@/lib/data/validators'
import {
  createAgentSession,
  findAgentSessionById,
  findMissionSessionStatus,
  listAgentSessions,
  updateAgentSessionStatus,
  recordSessionEvent as _recordSessionEvent,
  listSessionEvents as _listSessionEvents,
  getNextEventSeq,
} from '@/lib/data/sessions'
import { killSessionByOwner } from '@/lib/data/session-kill'
import { dispatchSpawn } from '@/lib/kairos/spawn'
import { resolveSessionAnchor } from '@/lib/data/hangar-access'

// Spawn a new agent session. Creates the row, then asks the worker host to
// shell the CLI. If the worker isn't reachable the row stays in 'queued' and
// the operator can retry — nothing else breaks.
export async function spawnSessionAction(input: SpawnSessionInput) {
  const userId = await requireVorath()
  const parsed = spawnSessionSchema.parse(input)
  const anchor = await resolveSessionAnchor(userId, { projectId: parsed.projectId, taskId: parsed.taskId })
  if (!anchor.ok) throw new Error(anchor.message)

  const session = await createAgentSession(userId, { ...parsed, projectId: anchor.projectId ?? parsed.projectId })

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
  const userId = await requireVorath()
  const row = await findAgentSessionById(id, userId)
  if (!row) throw new Error('Session not found or unauthorized')
  return row
}

const missionStatusSchema = z.object({
  sessionId: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
})

export async function getMissionSessionStatusAction(input: z.input<typeof missionStatusSchema>) {
  const { sessionId, projectId, taskId } = missionStatusSchema.parse(input)
  const { userId } = await requireMemberAccess(projectId)
  assertVorath(userId)
  const row = await findMissionSessionStatus(sessionId, projectId, taskId)
  if (!row) throw new Error('Mission session not found')
  return row
}

// The sidebar's live-sessions button polls this for every user: empty for non-Vorath users.
export async function listSessionsAction(input: ListSessionsInput = { liveOnly: false, limit: 20, offset: 0 }) {
  const userId = await requireAuth()
  if (!canUseVorath(userId)) return []
  const parsed = listSessionsSchema.parse(input)
  return listAgentSessions(userId, parsed)
}

export async function updateSessionStatusAction(id: string, patch: UpdateSessionStatusInput) {
  const userId = await requireVorath()
  const parsed = updateSessionStatusSchema.parse(patch)
  const row = await updateAgentSessionStatus(id, userId, parsed)
  if (!row) throw new Error('Session not found or unauthorized')
  return row
}

export async function recordSessionEventAction(id: string, input: RecordSessionEventInput) {
  const userId = await requireVorath()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  const parsed = recordSessionEventSchema.parse(input)
  return _recordSessionEvent(id, parsed)
}

export async function getNextEventSeqAction(id: string) {
  const userId = await requireVorath()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  return getNextEventSeq(id)
}

// opts is caller-supplied and a server action is directly invocable, so the
// tail params go through the same bounded schema the MCP tool uses — an
// unbounded limit would otherwise reach .limit() and pull a whole transcript.
export async function listSessionEventsAction(id: string, opts: SessionEventsTailArgs = {}) {
  const userId = await requireVorath()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')
  const parsed = sessionEventsTailArgsSchema.parse(opts)
  return _listSessionEvents(id, parsed)
}

export async function killSessionAction(id: string) {
  const userId = await requireVorath()
  const session = await findAgentSessionById(id, userId)
  if (!session) throw new Error('Session not found or unauthorized')

  const { row } = await killSessionByOwner(session, userId, 'app', { workerPidRequired: true })
  return row
}
