import { z } from 'zod'

// Kairos promises (docs: Phase 2 Track B). Stored as the server-owned
// `kairosPromises` key in user_preferences.preferences. The list schema is
// shared verbatim by the list_kairos_promises MCP tool and
// GET /api/v1/kairos/promises (locked by kairos-promises-parity.test.ts).

export const MAX_OPEN_PROMISES = 12
export const MAX_CLOSED_PROMISES = 60
export const MAX_PROMISES_PER_CALL = 3
export const PROMISE_OUTCOME_MIN_CHARS = 10
export const PROMISE_OUTCOME_MAX_CHARS = 160

export const promiseDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T12:00:00.000Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'date is not a real calendar date')

export const promiseSourceSchema = z.object({
  kind: z.enum(['weekly_review', 'goal']),
  jobId: z.string().min(1).max(100).optional(),
  goalId: z.string().min(1).max(100).optional(),
  isoWeek: z.string().min(1).max(20).optional(),
}).strict()

export const promiseCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card_done'), projectId: z.string().uuid(), taskId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('owner_confirm') }).strict(),
])

export const promiseClosedBySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('check'), activityEventId: z.string().uuid(), actorId: z.string().nullable(), at: z.string() }).strict(),
  z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']) }).strict(),
  z.object({ kind: z.literal('rule'), reason: z.literal('lapsed_14d') }).strict(),
])

export const promiseStatusSchema = z.enum(['open', 'kept', 'dropped', 'lapsed'])

export const kairosPromiseSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  outcome: z.string().min(1).max(PROMISE_OUTCOME_MAX_CHARS),
  dueDate: promiseDateSchema,
  createdAt: z.string(),
  source: promiseSourceSchema,
  check: promiseCheckSchema,
  status: promiseStatusSchema,
  closedAt: z.string().optional(),
  closedBy: promiseClosedBySchema.optional(),
  agentDoneSeenAt: z.string().optional(),
  renegotiations: z.number().int().nonnegative(),
  dueHistory: z.array(z.object({ dueDate: promiseDateSchema, changedAt: z.string(), via: z.enum(['session', 'telegram']) }).strict()),
  nudge: z.object({ claimedAt: z.string(), delivered: z.boolean(), memoryId: z.string().optional() }).strict().optional(),
}).strict()

export const kairosPromisesStateSchema = z.object({
  v: z.literal(1),
  nextSeq: z.number().int().positive(),
  open: z.array(kairosPromiseSchema).max(MAX_OPEN_PROMISES),
  closed: z.array(kairosPromiseSchema).max(MAX_CLOSED_PROMISES),
}).strict()

export type PromiseSource = z.infer<typeof promiseSourceSchema>
export type PromiseCheck = z.infer<typeof promiseCheckSchema>
export type PromiseClosedBy = z.infer<typeof promiseClosedBySchema>
export type PromiseStatus = z.infer<typeof promiseStatusSchema>
export type KairosPromise = z.infer<typeof kairosPromiseSchema>
export type KairosPromisesState = z.infer<typeof kairosPromisesStateSchema>

// One promise as Kairos proposes it (weekly review / goal approval). Strict:
// status, seq and check are server-decided, never accepted from the caller.
export const promiseProposalSchema = z.object({
  outcome: z.string().trim().min(PROMISE_OUTCOME_MIN_CHARS).max(PROMISE_OUTCOME_MAX_CHARS),
  dueDate: promiseDateSchema,
  taskId: z.string().uuid().optional(),
}).strict()

export type PromiseProposal = z.infer<typeof promiseProposalSchema>

export const listKairosPromisesSchema = z.object({
  scope: z.enum(['open', 'all']).default('open'),
})

export type ListKairosPromisesInput = z.infer<typeof listKairosPromisesSchema>

// Owner-only (server actions under requireAuth, Telegram operator chat).
export const ownerPromiseIdSchema = z.string().uuid()
export const ownerRenegotiateSchema = z.object({
  promiseId: z.string().uuid(),
  dueDate: promiseDateSchema,
})
