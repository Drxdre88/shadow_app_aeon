import { z } from 'zod'
import { promiseDateSchema } from './kairos-promises'

// The owner's decision journal (Phase 3, P3-1). Big non-trading calls the
// owner writes himself, stored as the server-owned `kairosDecisions` key in
// user_preferences.preferences. Separate from Vorath's predictions: nothing
// here feeds his track record. logDecisionSchema / listDecisionsSchema are
// shared by the MCP tools and /api/v1/kairos/decisions (kairos-decisions-parity).

export const MAX_OPEN_DECISIONS = 60
export const MAX_CLOSED_DECISIONS = 400
export const DECISION_TEXT_MIN_CHARS = 5
export const DECISION_TEXT_MAX_CHARS = 300
export const DECISION_EXPECTATION_MIN_CHARS = 3
export const DECISION_EXPECTATION_MAX_CHARS = 300
export const DECISION_TYPE_MIN_CHARS = 2
export const DECISION_TYPE_MAX_CHARS = 40
export const DECISION_MIN_PROBABILITY = 0.5
export const DECISION_MAX_PROBABILITY = 0.95

const SURE_MESSAGE = 'how sure must be between 50% and 95% (0.5–0.95)'

export const decisionOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner'), via: z.enum(['app', 'telegram']) }).strict(),
  z.object({ kind: z.literal('relayed'), via: z.enum(['mcp', 'rest']) }).strict(),
])

export const decisionVerdictSchema = z.enum(['right', 'wrong', 'void'])
export const decisionStatusSchema = z.enum(['open', 'right', 'wrong', 'void'])
export const decisionSettledViaSchema = z.enum(['app', 'telegram'])

export const kairosDecisionSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  decision: z.string().min(1).max(DECISION_TEXT_MAX_CHARS),
  expectation: z.string().min(1).max(DECISION_EXPECTATION_MAX_CHARS),
  probability: z.number().min(DECISION_MIN_PROBABILITY).max(DECISION_MAX_PROBABILITY),
  decisionType: z.string().min(1).max(DECISION_TYPE_MAX_CHARS),
  checkBy: promiseDateSchema,
  origin: decisionOriginSchema,
  confirmedAt: z.string().optional(),
  createdAt: z.string(),
  status: decisionStatusSchema,
  settledAt: z.string().optional(),
  settledVia: decisionSettledViaSchema.optional(),
}).strict()

export const kairosDecisionsStateSchema = z.object({
  v: z.literal(1),
  nextSeq: z.number().int().positive(),
  open: z.array(kairosDecisionSchema).max(MAX_OPEN_DECISIONS),
  closed: z.array(kairosDecisionSchema).max(MAX_CLOSED_DECISIONS),
}).strict()

export type DecisionOrigin = z.infer<typeof decisionOriginSchema>
export type DecisionVerdict = z.infer<typeof decisionVerdictSchema>
export type DecisionStatus = z.infer<typeof decisionStatusSchema>
export type DecisionSettledVia = z.infer<typeof decisionSettledViaSchema>
export type KairosDecision = z.infer<typeof kairosDecisionSchema>
export type KairosDecisionsState = z.infer<typeof kairosDecisionsStateSchema>

// A decision the owner made himself — never a trade, never inferred.
export const logDecisionSchema = z.object({
  decision: z.string().trim()
    .min(DECISION_TEXT_MIN_CHARS, `say what you decided (at least ${DECISION_TEXT_MIN_CHARS} characters)`)
    .max(DECISION_TEXT_MAX_CHARS),
  expectation: z.string().trim()
    .min(DECISION_EXPECTATION_MIN_CHARS, 'say what you expect to happen')
    .max(DECISION_EXPECTATION_MAX_CHARS),
  probability: z.number().finite().min(DECISION_MIN_PROBABILITY, SURE_MESSAGE).max(DECISION_MAX_PROBABILITY, SURE_MESSAGE),
  decisionType: z.string().trim()
    .min(DECISION_TYPE_MIN_CHARS, 'pick a decision type')
    .max(DECISION_TYPE_MAX_CHARS),
  checkBy: promiseDateSchema,
}).strict()

export type LogDecisionInput = z.infer<typeof logDecisionSchema>

export const listDecisionsSchema = z.object({
  scope: z.enum(['open', 'all']).default('open'),
  format: z.enum(['json', 'markdown']).default('json'),
})

export type ListDecisionsInput = z.infer<typeof listDecisionsSchema>

// Owner-only (server actions under requireAuth, the Telegram operator chat).
export const ownerDecisionVerdictSchema = z.object({
  decisionId: z.string().uuid(),
  verdict: decisionVerdictSchema,
})

export const ownerDecisionIdSchema = z.object({ decisionId: z.string().uuid() })
