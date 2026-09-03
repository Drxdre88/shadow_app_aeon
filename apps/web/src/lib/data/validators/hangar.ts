import { z } from 'zod'
import { agentSessionEngineSchema } from './sessions'

// ─────────────────────────────────────────────────────────────────────────
// AI Hangar (Sprint 1) — agent-mission cards, pull-mode claim, repo registry.
// See docs/ai-hangar-blueprint-1808.md §2 and §5.
// ─────────────────────────────────────────────────────────────────────────

export const hangarObjectiveSchema = z.enum([
  'bug_fix',
  'implement',
  'recon',
  'analysis',
  'plan',
])
// One engine enum for the whole system — a card's agent, a session's engine and
// a repo's allowed engines must never drift apart.
export const hangarAgentSchema = agentSessionEngineSchema
// Single value for now — the deliverable is derived from the objective.
export const hangarOutputModeSchema = z.enum(['auto'])

// Model ids are passed straight to an engine CLI by the runner, so the charset
// is restricted to what a real model id needs. The leading character must be
// alphanumeric so an id can never be read as a flag ('-p', '--dangerously-…').
export const HANGAR_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

// The repo slug reaches the runner the same way the model id does (argv, then
// a host path lookup), so it gets the same shell-inert treatment: leading
// alphanumeric so it can never read as a flag, no spaces or shell
// metacharacters. The charset alone does NOT stop traversal (a leading dot is
// banned, an inner '/../' is not), so segment checking is mandatory — see
// isSafeRepoSlug.
export const HANGAR_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Shell-inert AND traversal-free: the full repo-slug contract. */
export function isSafeRepoSlug(value: string): boolean {
  return HANGAR_REPO_RE.test(value) && !value.split('/').includes('..')
}

// Stored under boardTasks.metadata.hangar. Card title carries the mission
// name; session_ids / last_result are system-written, never user-supplied.
export const hangarCardMetadataSchema = z.object({
  objective:   hangarObjectiveSchema,
  repo:        z.string().trim().min(1).max(120).refine(isSafeRepoSlug, 'Invalid repo slug'),
  agent:       hangarAgentSchema.default('copilot'),
  // The model id reaches the runner's CLI argv — keep it to a shell-inert
  // charset so a card can never smuggle flags or shell metacharacters.
  model:       z.string().trim().max(80).regex(HANGAR_MODEL_RE, 'Invalid model id').nullable().optional(),
  instruction: z.string().trim().min(1).max(20_000),
  outputMode:  hangarOutputModeSchema.default('auto'),
  // Launch-on-drop consent: only cards that opted in fire when dragged into
  // the board's designated launch column. Defaults off — every launch is a
  // conscious act unless the owner armed the card. Cleared again on launch.
  autoRun:     z.boolean().default(false),
  lastLaunchedAt: z.string().datetime().optional(),
  subagents:   z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  sessionIds:  z.array(z.string().uuid()).default([]),
  lastResult:  z.record(z.string(), z.unknown()).optional(),
})

/**
 * What a card EDITOR may write. Deliberately laxer than the strict schema on
 * completeness (a half-filled draft must be saveable) and strictly narrower on
 * surface: the system-written fields — sessionIds, lastResult, lastLaunchedAt
 * — are absent, so zod strips a client that tries to forge launch history or
 * hide a live mission. Launching still runs the strict schema, so an
 * incomplete draft can never spawn an agent.
 */
export const hangarCardDraftSchema = z.object({
  objective:   hangarObjectiveSchema,
  // Empty is a legal draft; anything non-empty must already be shell-inert.
  repo:        z.string().trim().max(120).refine((v) => v === '' || isSafeRepoSlug(v), 'Invalid repo slug'),
  agent:       hangarAgentSchema,
  model:       z.string().trim().max(80).regex(HANGAR_MODEL_RE, 'Invalid model id').nullable(),
  instruction: z.string().trim().max(20_000),
  outputMode:  hangarOutputModeSchema,
  autoRun:     z.boolean(),
})

// Runner polls with its own id; engines narrows the claim to what it can spawn.
export const claimSessionSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  engines:  z.array(hangarAgentSchema).min(1).optional(),
})

export const heartbeatSessionSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
})

// One bounds definition for the event-tail params, shared by both surfaces.
// The schemas below differ only in how they get to a number/boolean — REST
// reads query strings, MCP and the server actions pass native JSON — so the
// bounds live here and nowhere else. Hand-rolling them on a surface is how MCP
// drifted to limit<=1000 with a boolean tail while REST enforced 500.
const TAIL_AFTER_SEQ_MIN = -1
const TAIL_LIMIT_MIN = 1
const TAIL_LIMIT_MAX = 500
const TAIL_LIMIT_DEFAULT = 500

// Event-tail params (REST ?afterSeq=&limit=). Coerced because they arrive as
// query strings — un-coerced, `?limit=abc` reaches the driver as NaN (raw DB
// error → 500) and an unbounded limit lets one request pull a whole
// transcript. afterSeq allows -1 ("everything") to match list_session_events.
export const sessionEventsTailSchema = z.object({
  afterSeq: z.coerce.number().int().min(TAIL_AFTER_SEQ_MIN).optional(),
  limit:    z.coerce.number().int().min(TAIL_LIMIT_MIN).max(TAIL_LIMIT_MAX).default(TAIL_LIMIT_DEFAULT),
  // Read the LAST n events instead of the first (still ascending in the
  // response). NOT z.coerce.boolean — that turns the string "false" into true.
  tail:     z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
})

// Same params, native JSON types — for callers that already hold numbers and
// booleans: the MCP tool schema (its shape is published as JSON Schema, so a
// string-coerced sibling would advertise the wrong types to a client) and the
// server actions, which are directly invocable and must not pass an unbounded
// limit to the data layer. Every field is optional; the data layer applies its
// own default so an omitted limit stays "the data layer's page size".
export const sessionEventsTailArgsSchema = z.object({
  afterSeq: z.number().int().min(TAIL_AFTER_SEQ_MIN).optional(),
  limit:    z.number().int().min(TAIL_LIMIT_MIN).max(TAIL_LIMIT_MAX).optional(),
  tail:     z.boolean().optional(),
})

// Engine-agnostic terminal envelope — the runner extracts it from stdout and
// posts it as the session's kind:'result' event.
export const hangarResultEnvelopeSchema = z.object({
  status:    z.enum(['completed', 'needs_input', 'failed']),
  outcome:   z.string().trim().max(60),
  summary:   z.string().trim().max(8000),
  branch:    z.string().trim().max(255).nullable().optional(),
  commit:    z.string().trim().max(64).nullable().optional(),
  artifacts: z.array(z.string().trim().max(500)).max(50).optional(),
  tests:     z.object({
    status:  z.enum(['passed', 'failed', 'not_run']),
    summary: z.string().trim().max(500).optional(),
  }).optional(),
  questions: z.array(z.string().trim().max(1000)).max(20).optional(),
  recommended_tasks: z.array(z.object({
    title:       z.string().trim().max(255),
    objective:   hangarObjectiveSchema,
    instruction: z.string().trim().max(10_000),
  })).max(20).optional(),
  // Flight Deck mission stats, aggregated runner-side from the engine stream
  // (single aggregation point in poller.finalize). Omit-when-zero convention:
  // absent field = engine reported nothing, never "zero spend".
  // Every number here is a count, a duration or a spend — none can be
  // negative. Without the floor a mis-parsed engine stream can post -1 as
  // "unknown" and the Flight Deck totals it into the mission's cost.
  stats: z.object({
    totalCostUsd:        z.number().finite().min(0).optional(),
    inputTokens:         z.number().int().min(0).optional(),
    outputTokens:        z.number().int().min(0).optional(),
    cacheReadTokens:     z.number().int().min(0).optional(),
    cacheCreationTokens: z.number().int().min(0).optional(),
    thinkingTokens:      z.number().int().min(0).optional(),
    numTurns:            z.number().int().min(0).optional(),
    durationMs:          z.number().finite().min(0).optional(),
    durationApiMs:       z.number().finite().min(0).optional(),
    toolCalls:           z.number().int().min(0).optional(),
    model:               z.string().trim().max(120).optional(),
  }).optional(),
})

export const createHangarRepoSchema = z.object({
  realmId:        z.string().uuid(),
  slug:           z.string().trim().min(1).max(120),
  name:           z.string().trim().min(1).max(255),
  gitUrl:         z.string().trim().min(1).max(500),
  ghSlug:         z.string().trim().max(200).nullable().optional(),
  defaultBranch:  z.string().trim().max(120).optional(),
  branchPrefix:   z.string().trim().max(60).optional(),
  allowedEngines: z.array(hangarAgentSchema).optional(),
  runCmd:         z.string().trim().max(500).nullable().optional(),
  envSetupCmd:    z.string().trim().max(500).nullable().optional(),
  appUrl:         z.string().trim().max(500).nullable().optional(),
  notes:          z.string().trim().max(4000).nullable().optional(),
  active:         z.boolean().optional(),
  metadata:       z.record(z.string(), z.unknown()).optional(),
})

export const updateHangarRepoSchema = createHangarRepoSchema.omit({ realmId: true }).partial()

export type HangarObjective        = z.infer<typeof hangarObjectiveSchema>
export type HangarAgent            = z.infer<typeof hangarAgentSchema>
export type HangarOutputMode       = z.infer<typeof hangarOutputModeSchema>
export type HangarCardMetadata     = z.infer<typeof hangarCardMetadataSchema>
export type ClaimSessionInput      = z.infer<typeof claimSessionSchema>
export type HeartbeatSessionInput  = z.infer<typeof heartbeatSessionSchema>
export type SessionEventsTailArgs  = z.infer<typeof sessionEventsTailArgsSchema>
export type HangarResultEnvelope   = z.infer<typeof hangarResultEnvelopeSchema>
export type CreateHangarRepoInput  = z.infer<typeof createHangarRepoSchema>
export type UpdateHangarRepoInput  = z.infer<typeof updateHangarRepoSchema>
