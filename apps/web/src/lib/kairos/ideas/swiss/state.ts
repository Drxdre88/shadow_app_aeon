import { z } from 'zod'
import type { IdeaRefinement } from '../judge-prompt'
import type { IdeaCritique } from '../types'

// Swiss state carried on every idea_judge job context (ctx.swiss) while the
// multi-round judge runs. ctx.pairs / ctx.matches hold every Swiss pair and
// match so far (this round's included); roundPairIds names this round's.
// Round 1's critiques and refinements ride along so the final round can
// persist the whole night once.

const critiqueSchema = z.object({
  verdict: z.enum(['grounded', 'ungrounded', 'contradicted']),
  supports: z.array(z.string()),
  contradicts: z.array(z.string()),
  alreadyKnown: z.boolean(),
  meaningfullyDifferent: z.boolean().nullable(),
  note: z.string(),
  mappingHolds: z.boolean().nullable().optional(),
})

const refinementSchema = z.object({ claim: z.string(), why: z.string(), nextStep: z.string() })

export const swissStateSchema = z.object({
  v: z.literal(1),
  round: z.number().int().min(1),
  rounds: z.number().int().min(1).max(8),
  roundPairIds: z.array(z.string()),
  votes: z.record(z.string(), z.string()),
  byes: z.array(z.string()),
  viable: z.array(z.string()),
  critiques: z.record(z.string(), critiqueSchema),
  refinements: z.record(z.string(), refinementSchema),
})

export type SwissState = z.infer<typeof swissStateSchema>

export function readSwissState(value: unknown): SwissState | null {
  const parsed = swissStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const critiquesToRecord = (m: ReadonlyMap<string, IdeaCritique>): SwissState['critiques'] => Object.fromEntries(m)
export const refinementsToRecord = (m: ReadonlyMap<string, IdeaRefinement>): SwissState['refinements'] => Object.fromEntries(m)

export const critiquesFrom = (s: SwissState): Map<string, IdeaCritique> => new Map(Object.entries(s.critiques))
export const refinementsFrom = (s: SwissState): Map<string, IdeaRefinement> => new Map(Object.entries(s.refinements))
export const votesFrom = (s: SwissState): Map<string, string> => new Map(Object.entries(s.votes))
