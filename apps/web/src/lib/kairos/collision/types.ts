import { z } from 'zod'
import type { IdeaBridgeMeta } from '@/lib/kairos/ideas/types'

// Collision engine (lane B): far-apart memory pairs offered to the nightly
// idea generator; a blend survives only with a consistent relational mapping.

export const COLLISION_PAIRS = 3
// Far but not random: the pair's own cosine band.
export const COLLISION_COS_MIN = 0.1
export const COLLISION_COS_MAX = 0.45
// Both sides must stay this close to the anchor (latest Aether).
export const COLLISION_ANCHOR_FLOOR = 0.1
// No anchor: a shared neighbour within this cosine of both sides.
export const COLLISION_TRIANGLE_MIN = 0.35
// Title+summary token Jaccard at or above this is a surface twin.
export const COLLISION_JACCARD_MAX = 0.35
export const COLLISION_AGE_GAP_DAYS = 30
// A pair offered in `on` mode is not offered again for this long.
export const COLLISION_RECENT_DAYS = 30
export const COLLISION_TEXT_CAP = 320

export interface CollisionCandidate {
  id: string
  dominionId: string | null
  title: string
  summary: string | null
  createdAt: Date
  embedding: number[]
  // Memory ids this row already links to.
  linkedIds: string[]
}

export const collisionPairSchema = z.object({
  id: z.string().min(1),
  pairKey: z.string().min(1),
  aId: z.string().min(1),
  bId: z.string().min(1),
  aArea: z.string().nullable(),
  bArea: z.string().nullable(),
  aDate: z.string(),
  bDate: z.string(),
  aText: z.string(),
  bText: z.string(),
  cos: z.number(),
  relevance: z.number(),
  score: z.number(),
})
export type CollisionPair = z.infer<typeof collisionPairSchema>

export const collisionContextSchema = z.object({
  v: z.literal(1),
  mode: z.enum(['observe', 'on']),
  anchor: z.enum(['aether', 'triangle']),
  considered: z.number(),
  pairs: z.array(collisionPairSchema),
})
export type CollisionContext = z.infer<typeof collisionContextSchema>

export type BridgeMeta = IdeaBridgeMeta

export function readCollisionContext(jobContext: Readonly<Record<string, unknown>> | null | undefined): CollisionContext | null {
  const parsed = collisionContextSchema.safeParse(jobContext?.collision)
  return parsed.success ? parsed.data : null
}

export const pairKeyOf = (aId: string, bId: string) => (aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`)
