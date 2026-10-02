import { z } from 'zod'
import { extractJsonBlock } from '@/lib/kairos/_prompt-utils'
import type { Origin } from '@/lib/kairos/origin'
import { GOAL_ACTOR_KINDS, GOAL_EVENTS, GOAL_STATES } from './state'

// Goal rows (Phase 2, Track A) live in `memories`:
//   proposal  type 'inbound', sourceMetadata.kind 'goal', status 'pending', expiresAt,
//             origin {kind:'kairos', via:'thinking:goal_propose'}, NO introspection flag
//   approved  type 'kairos_goal', status 'accepted', goal.state 'active' → terminal
// GoalMeta v1 is sourceMetadata.goal.

export const GOAL_PROPOSAL_KIND = 'goal'
export const GOAL_MEMORY_TYPE = 'kairos_goal'
export const GOAL_PROPOSE_KIND = 'goal_propose'
export const GOAL_ORIGIN_VIA = 'thinking:goal_propose'
export const GOAL_ORIGIN: Origin = { kind: 'kairos', via: GOAL_ORIGIN_VIA }

export const GOAL_OPEN_CAP = 2
export const GOAL_PROPOSAL_TTL_MS = 72 * 3_600_000
export const GOAL_TIMEOUT_GRACE_MS = 7 * 86_400_000
export const GOAL_DUE_MIN_DAYS = 3
export const GOAL_DUE_MAX_DAYS = 14
export const GOAL_HISTORY_CAP = 20
export const GOAL_SEED_DAYS = 30
export const GOAL_VETO_MEMORY_DAYS = 30

export const GOAL_TITLE_MAX = 120
export const GOAL_QUESTION_MAX = 300
export const GOAL_WHY_MAX = 600
export const GOAL_CHECK_MAX = 300
export const GOAL_NOTE_MAX = 2000

const iso = z.string().min(1)

export const goalSeedSchema = z.object({ kind: z.enum(['idea', 'failed_goal']), id: z.string().min(1) })
export type GoalSeed = z.infer<typeof goalSeedSchema>

export const goalHistoryEntrySchema = z.object({
  at: iso,
  event: z.enum(GOAL_EVENTS),
  from: z.enum(GOAL_STATES).nullable(),
  to: z.enum(GOAL_STATES),
  actor: z.enum(GOAL_ACTOR_KINDS),
  via: z.string().optional(),
})
export type GoalHistoryEntry = z.infer<typeof goalHistoryEntrySchema>

export const goalMetaSchema = z.object({
  v: z.literal(1),
  state: z.enum(GOAL_STATES),
  kind: z.literal('investigation'),
  question: z.string(),
  why: z.string(),
  successCheck: z.object({ type: z.literal('owner_confirm'), text: z.string() }),
  dueInDays: z.number().int(),
  dueAt: iso.nullable(),
  seeds: z.array(goalSeedSchema),
  proposedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proposedAt: iso,
  expiresAt: iso,
  jobId: z.string().nullable(),
  answeredBy: z.string().nullable(),
  decidedAt: iso.nullable(),
  decidedVia: z.string().nullable(),
  vetoNote: z.string().nullable(),
  closedAt: iso.nullable(),
  closedBy: z.string().nullable(),
  closeNote: z.string().nullable(),
  telegram: z.object({ chatId: z.union([z.string(), z.number()]), messageId: z.number() }).nullable(),
  history: z.array(goalHistoryEntrySchema),
})
export type GoalMeta = z.infer<typeof goalMetaSchema>

export function readGoalMeta(sourceMetadata: unknown): GoalMeta | null {
  if (!sourceMetadata || typeof sourceMetadata !== 'object') return null
  const parsed = goalMetaSchema.safeParse((sourceMetadata as Record<string, unknown>).goal)
  return parsed.success ? parsed.data : null
}

export function appendGoalHistory(history: readonly GoalHistoryEntry[], entry: GoalHistoryEntry): GoalHistoryEntry[] {
  return [...history, entry].slice(-GOAL_HISTORY_CAP)
}

// ── Model output (goal_propose) ────────────────────────────────────────────

// Strict shape only; content limits (lengths, due window, topics) are the
// policy's job so every rejection carries a named reason.
const LOOSE_TEXT = z.string().trim().min(1).max(4000)

export const goalCandidateSchema = z.object({
  title: LOOSE_TEXT,
  question: LOOSE_TEXT,
  why: LOOSE_TEXT,
  seedIds: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  successCheck: LOOSE_TEXT,
  dueInDays: z.number().int(),
  dominionId: z.string().trim().min(1).nullable(),
}).strict()
export type GoalCandidate = z.infer<typeof goalCandidateSchema>

export const goalProposeOutputSchema = z.object({ goal: goalCandidateSchema.nullable() }).strict()

export function parseGoalProposeText(text: string): GoalCandidate | null {
  const parsed = goalProposeOutputSchema.safeParse(extractJsonBlock(text, 'goal-propose'))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`goal-propose: ${issue.path.join('.') || 'output'} — ${issue.message}`)
  }
  return parsed.data.goal
}
