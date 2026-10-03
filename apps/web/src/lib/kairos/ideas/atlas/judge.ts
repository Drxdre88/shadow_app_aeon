import { z } from 'zod'
import type { KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { pairOutcome } from '../elo'
import type { IdeaMatch, IdeaPair } from '../pairing'
import { IDEA_KINDS, IDEA_LEAPS } from '../types'
import type { AtlasTag } from './cells'
import type { ChallengeResult } from './update'

// Atlas state carried on the idea_judge context (ctx.atlas). Holder
// challenges are extra matches the judge votes on; their pairs stay OUT of
// ctx.pairs, so Elo never counts them.

export const ATLAS_MAX_CHALLENGES = 3

const challengeSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  forward: z.string().min(1),
  swapped: z.string().min(1),
  cell: z.string().min(1),
})

export const atlasJudgeSchema = z.object({
  v: z.literal(1),
  mode: z.enum(['observe', 'on']),
  areas: z.array(z.string()).max(64),
  targets: z.array(z.string()).max(16),
  holders: z.array(z.object({ id: z.string().min(1), cell: z.string().min(1), title: z.string(), claim: z.string() })).max(ATLAS_MAX_CHALLENGES),
  challenges: z.array(challengeSchema).max(ATLAS_MAX_CHALLENGES),
})

export type AtlasJudgeState = z.infer<typeof atlasJudgeSchema>
export type AtlasChallenge = z.infer<typeof challengeSchema>

export function readAtlasJudge(value: unknown): AtlasJudgeState | null {
  const parsed = atlasJudgeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const atlasTagSchema = z.object({
  cell: z.string().min(1),
  area: z.string().min(1),
  kind: z.enum(IDEA_KINDS),
  leap: z.enum(IDEA_LEAPS),
  leapClaimed: z.enum(IDEA_LEAPS).nullable(),
})

export function readAtlasTag(value: unknown): AtlasTag | null {
  const parsed = atlasTagSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Highest numeric suffix in use (p7 → 7), so new ids never collide.
export function maxIdNumber(ids: readonly string[]): number {
  return ids.reduce((max, id) => {
    const n = Number(id.replace(/^\D+/, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
}

const keyNum = (k: string) => Number(k.replace(/^\D+/, ''))

export interface ChallengePlan {
  holders: AtlasJudgeState['holders']
  challenges: AtlasChallenge[]
  matches: IdeaMatch[]
}

// One challenge per occupied cell (longest-unchallenged first), challenger =
// tonight's first contender in that cell by key order.
export function planChallenges(
  contenders: ReadonlyArray<{ key: string; cell: string }>,
  state: KairosIdeaAtlasState,
  used: { pairs: readonly IdeaPair[]; matches: readonly IdeaMatch[] },
  max: number = ATLAS_MAX_CHALLENGES,
): ChallengePlan {
  const firstIn = new Map<string, string>()
  for (const c of [...contenders].sort((a, b) => keyNum(a.key) - keyNum(b.key))) {
    if (state.cells[c.cell]?.holder && !firstIn.has(c.cell)) firstIn.set(c.cell, c.key)
  }
  const cells = [...firstIn.keys()].sort((a, b) => {
    const la = state.cells[a]?.lastChallengeOn ?? ''
    const lb = state.cells[b]?.lastChallengeOn ?? ''
    return la !== lb ? (la < lb ? -1 : 1) : a < b ? -1 : 1
  }).slice(0, Math.max(0, max))
  let p = maxIdNumber(used.pairs.map((x) => x.id))
  let m = maxIdNumber(used.matches.map((x) => x.id))
  const plan: ChallengePlan = { holders: [], challenges: [], matches: [] }
  cells.forEach((cell, i) => {
    const holder = state.cells[cell]?.holder
    const key = firstIn.get(cell)
    if (!holder || !key) return
    const hid = `h${i + 1}`
    plan.holders.push({ id: hid, cell, title: holder.title, claim: holder.claim })
    const ch: AtlasChallenge = { id: `p${++p}`, a: key, b: hid, forward: `m${++m}`, swapped: `m${++m}`, cell }
    plan.challenges.push(ch)
    plan.matches.push({ id: ch.forward, pairId: ch.id, first: key, second: hid }, { id: ch.swapped, pairId: ch.id, first: hid, second: key })
  })
  return plan
}

export function challengeResult(ch: AtlasChallenge, votes: ReadonlyMap<string, string>): ChallengeResult {
  const out = pairOutcome(ch, votes)
  if (out.kind === 'none') return 'none'
  if (out.kind === 'draw') return 'draw'
  return out.winner === ch.a ? 'win' : 'loss'
}
