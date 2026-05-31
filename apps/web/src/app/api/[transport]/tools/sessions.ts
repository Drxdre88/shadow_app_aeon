import { z } from 'zod'
import {
  spawnSessionSchema,
  listSessionsSchema,
  agentSessionStatusSchema,
} from '@/lib/data/validators'
import {
  createAgentSession,
  findAgentSessionById,
  listAgentSessions,
  updateAgentSessionStatus,
  listSessionEvents,
} from '@/lib/data/sessions'
import { dispatchSpawn } from '@/lib/kairos/spawn'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// Kairos Phase 3 (D16) — MCP surface mirrors the REST endpoints under
// /api/v1/sessions/. Tools: spawn_session, list_sessions, get_session,
// kill_session, list_session_events. The MCP parity invariant requires
// these to share validators + data layer with the REST routes.

export const registerSessionTools: RegisterFn = (server) => {
  server.tool(
    'spawn_session',
    'Dispatch an AI session (Claude Code, Codex) on the operator\'s behalf. Creates an agent_sessions row, asks the worker host to shell the CLI, returns the session id and live status.',
    {
      engine:     z.enum(['claude', 'codex']).describe('Which CLI to spawn'),
      goal:       z.string().min(1).max(2000).describe('One-line operator-facing goal'),
      prompt:     z.string().min(1).max(20_000).describe('Prompt sent to the engine'),
      repo:       z.string().max(200).nullable().optional().describe('Repo slug the session runs against'),
      branch:     z.string().max(120).nullable().optional().describe('Git branch to start from'),
      projectId:  z.string().uuid().nullable().optional().describe('Optional project anchor'),
      realmId:    z.string().uuid().nullable().optional().describe('Optional realm anchor'),
      dominionId: z.string().uuid().nullable().optional().describe('Optional Dominion anchor'),
      metadata:   z.record(z.string(), z.unknown()).optional().describe('Free-form metadata'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = spawnSessionSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)

      const session = await createAgentSession(uid, parsed.data)
      const callbackBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.AEON_BASE_URL || ''
      const callbackToken = process.env.AEON_API_KEY || ''
      const dispatch = await dispatchSpawn({
        sessionId: session.id,
        engine: session.engine,
        repo: session.repo,
        branch: session.branch,
        goal: session.goal,
        prompt: session.prompt,
        callbackToken,
        callbackBaseUrl,
      })
      if (dispatch.dispatched) {
        await updateAgentSessionStatus(session.id, uid, {
          status: 'running',
          workerHost: dispatch.workerHost,
          startedAt: new Date(),
        })
      }
      const final = await findAgentSessionById(session.id, uid)
      return ok({ session: final, dispatched: dispatch.dispatched, reason: dispatch.reason ?? null })
    }
  )

  server.tool(
    'list_sessions',
    'List agent sessions for the calling user. Optional filters: status, dominionId, projectId, liveOnly.',
    {
      status:     z.union([agentSessionStatusSchema, z.array(agentSessionStatusSchema)]).optional(),
      dominionId: z.string().uuid().optional(),
      projectId:  z.string().uuid().optional(),
      liveOnly:   z.boolean().optional(),
      limit:      z.number().int().min(1).max(100).optional(),
      offset:     z.number().int().min(0).optional(),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listSessionsSchema.safeParse({
        liveOnly: args.liveOnly ?? false,
        limit:    args.limit    ?? 20,
        offset:   args.offset   ?? 0,
        status:   args.status,
        dominionId: args.dominionId,
        projectId:  args.projectId,
      })
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const rows = await listAgentSessions(uid, parsed.data)
      return ok(rows)
    }
  )

  server.tool(
    'get_session',
    'Fetch an agent session by id.',
    { sessionId: z.string().uuid() },
    async ({ sessionId }, extra) => {
      const uid = getUserId(extra)
      const row = await findAgentSessionById(sessionId, uid)
      if (!row) return notFound('Session')
      return ok(row)
    }
  )

  server.tool(
    'list_session_events',
    'List events for an agent session, optionally after a given seq for incremental tailing.',
    {
      sessionId: z.string().uuid(),
      afterSeq:  z.number().int().min(-1).optional(),
      limit:     z.number().int().min(1).max(1000).optional(),
    },
    async ({ sessionId, afterSeq, limit }, extra) => {
      const uid = getUserId(extra)
      const session = await findAgentSessionById(sessionId, uid)
      if (!session) return notFound('Session')
      const events = await listSessionEvents(sessionId, { afterSeq, limit })
      return ok(events)
    }
  )

  server.tool(
    'kill_session',
    'Terminate a live agent session. Marks status=killed even if the worker host is unreachable.',
    { sessionId: z.string().uuid() },
    async ({ sessionId }, extra) => {
      const uid = getUserId(extra)
      const session = await findAgentSessionById(sessionId, uid)
      if (!session) return notFound('Session')
      const workerUrl = process.env.KAIROS_WORKER_URL
      const workerSecret = process.env.KAIROS_WORKER_SECRET
      if (workerUrl) {
        try {
          await fetch(`${workerUrl.replace(/\/$/, '')}/kill/${sessionId}`, {
            method: 'POST',
            headers: workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {},
            signal: AbortSignal.timeout(5_000),
          })
        } catch {
          // best-effort
        }
      }
      const row = await updateAgentSessionStatus(sessionId, uid, {
        status: 'killed',
        endedAt: new Date(),
      })
      return ok(row)
    }
  )
}
