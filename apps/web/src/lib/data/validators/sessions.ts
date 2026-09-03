import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3 (D15–D16) — agent_sessions / session_events validators.
// ─────────────────────────────────────────────────────────────────────────

export const agentSessionEngineSchema = z.enum(['claude', 'codex', 'copilot'])
export const agentSessionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'killed',
  'timeout',
])
export const sessionEventKindSchema = z.enum([
  'status',
  'tool_use',
  'tool_result',
  'message',
  'stop',
  'error',
  // AI Hangar — terminal envelope the runner posts when a mission ends.
  'result',
  // Flight Deck typed telemetry, parsed runner-side from the engine stream.
  'thinking',
  'usage',
  'system',
])

export const spawnSessionSchema = z.object({
  engine:     agentSessionEngineSchema,
  goal:       z.string().trim().min(1).max(2000),
  prompt:     z.string().trim().min(1).max(20_000),
  repo:       z.string().trim().max(200).nullable().optional(),
  branch:     z.string().trim().max(120).nullable().optional(),
  projectId:  z.string().uuid().nullable().optional(),
  realmId:    z.string().uuid().nullable().optional(),
  dominionId: z.string().uuid().nullable().optional(),
  // AI Hangar — board card this mission was launched from.
  taskId:     z.string().uuid().nullable().optional(),
  metadata:   z.record(z.string(), z.unknown()).optional(),
})

// Worker host calls this to flip status as the CLI starts / ends.
export const updateSessionStatusSchema = z.object({
  status:     agentSessionStatusSchema,
  workerHost: z.string().trim().max(120).nullable().optional(),
  workerPid:  z.number().int().nullable().optional(),
  exitCode:   z.number().int().nullable().optional(),
  startedAt:  z.coerce.date().nullable().optional(),
  endedAt:    z.coerce.date().nullable().optional(),
  costUsd:    z.number().nullable().optional(),
})

// Payload size bound, measured in serialized UTF-16 chars (bytes can run up
// to ~3x for multi-byte content — the bound is a guardrail, not an exact
// wire size). The runner caps its texts at ~4KB, so 32K chars is generous
// headroom for typed telemetry; the terminal result envelope legitimately
// carries up to 20 recommended tasks and gets its own ceiling.
const EVENT_PAYLOAD_MAX_CHARS = 32_000
const RESULT_PAYLOAD_MAX_CHARS = 512_000

export const recordSessionEventSchema = z.object({
  seq:      z.number().int().min(0),
  kind:     sessionEventKindSchema,
  toolName: z.string().trim().max(80).nullable().optional(),
  payload:  z.record(z.string(), z.unknown()).optional(),
}).superRefine((event, ctx) => {
  if (!event.payload) return
  const limit = event.kind === 'result' ? RESULT_PAYLOAD_MAX_CHARS : EVENT_PAYLOAD_MAX_CHARS
  let size: number
  try {
    size = JSON.stringify(event.payload).length
  } catch {
    size = limit + 1
  }
  if (size > limit) {
    ctx.addIssue({ code: 'custom', path: ['payload'], message: `payload too large (${size} > ${limit} chars)` })
  }
})

// Flight Deck: the runner coalesces typed events into ~2s batches so a chatty
// mission stays inside the 60 writes/min budget. Every event carries its own
// runner-assigned seq — the batch is a transport envelope, not a unit of
// order. Members are validated INDIVIDUALLY at the route so one malformed
// event drops itself, never the 39 valid events beside it (a batch-level 400
// is unretriable and would silently eat telemetry).
export const recordSessionEventBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(100),
})

export const listSessionsSchema = z.object({
  status:     z.union([agentSessionStatusSchema, z.array(agentSessionStatusSchema)]).optional(),
  dominionId: z.string().uuid().optional(),
  projectId:  z.string().uuid().optional(),
  liveOnly:   z.boolean().default(false),
  since:      z.coerce.date().optional(),
  limit:      z.number().int().min(1).max(100).default(20),
  offset:     z.number().int().min(0).default(0),
})

export type AgentSessionEngine    = z.infer<typeof agentSessionEngineSchema>
export type AgentSessionStatus    = z.infer<typeof agentSessionStatusSchema>
export type SessionEventKind      = z.infer<typeof sessionEventKindSchema>
export type SpawnSessionInput     = z.infer<typeof spawnSessionSchema>
export type UpdateSessionStatusInput = z.infer<typeof updateSessionStatusSchema>
export type RecordSessionEventInput  = z.infer<typeof recordSessionEventSchema>
export type RecordSessionEventBatchInput = z.infer<typeof recordSessionEventBatchSchema>
export type ListSessionsInput     = z.infer<typeof listSessionsSchema>
