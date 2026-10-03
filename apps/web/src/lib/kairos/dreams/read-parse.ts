import { z } from 'zod'
import { extractJsonBlock } from '@/lib/kairos/_prompt-utils'
import type { DreamReadContext } from './read-prompt'

// Strict parse of the morning read (spec_dreams, lane C). Shape and lengths
// are strict (a violation throws → parse_failed); aliases the job never showed
// are dropped, and a hold left with fewer than two real memories is dropped.

const text = (max: number) => z.string().trim().min(1).max(max)
const alias = z.string().trim().min(1).max(12)

const rawSchema = z.object({
  holds: z.array(z.object({ pattern: text(200), refs: z.array(alias).max(8), strength: z.number().min(0).max(1) }).strict()).max(2),
  fragile: z.array(z.object({ ref: alias, situation: text(160), why: text(200) }).strict()).max(3),
  rehearsal: z.object({ ref: alias, worstCase: text(240), earlySign: text(160), guard: text(160) }).strict().nullable(),
  morningLine: text(140).nullable(),
}).strict()

export interface DreamHold {
  pattern: string
  memoryIds: string[]
}

export type DreamFragile =
  | { beliefId: string | null; claim: string; situation: string; why: string }
  | { principleIndex: number; situation: string; why: string }

export interface DreamRehearsal {
  goalId?: string
  promiseId?: string
  // The goal title or promise outcome the worst case is about.
  subject: string
  worstCase: string
  earlySign: string
  guard: string
}

export interface DreamReadResult {
  holds: DreamHold[]
  fragile: DreamFragile[]
  rehearsal: DreamRehearsal | null
  morningLine: string | null
}

export interface DreamReadOutput extends DreamReadResult {
  dreamt: true
  v: 1
  date: string
  dreamJobId: string
}

export function parseDreamReadText(raw: string, ctx: DreamReadContext): DreamReadResult {
  const parsed = rawSchema.parse(extractJsonBlock(raw, 'dream_read'))
  const memory = new Map(ctx.memories.map((m) => [m.alias, m.id]))
  const principle = new Map(ctx.principles.map((p) => [p.alias, p.index]))
  const belief = new Map(ctx.beliefs.map((b) => [b.alias, b]))
  const goal = new Map(ctx.goals.map((g) => [g.alias, g]))
  const promise = new Map(ctx.promises.map((p) => [p.alias, p]))

  const holds = [...parsed.holds]
    .sort((a, b) => b.strength - a.strength)
    .flatMap((h): DreamHold[] => {
      const memoryIds = [...new Set(h.refs.map((r) => memory.get(r)).filter((id): id is string => Boolean(id)))]
      return memoryIds.length >= 2 ? [{ pattern: h.pattern, memoryIds }] : []
    })

  const fragile = parsed.fragile.flatMap((f): DreamFragile[] => {
    const b = belief.get(f.ref)
    if (b) return [{ beliefId: b.id, claim: b.claim, situation: f.situation, why: f.why }]
    const index = principle.get(f.ref)
    if (index !== undefined) return [{ principleIndex: index, situation: f.situation, why: f.why }]
    return []
  })

  let rehearsal: DreamRehearsal | null = null
  if (parsed.rehearsal) {
    const { ref, worstCase, earlySign, guard } = parsed.rehearsal
    const g = goal.get(ref)
    const p = promise.get(ref)
    if (g) rehearsal = { goalId: g.id, subject: g.title, worstCase, earlySign, guard }
    else if (p) rehearsal = { promiseId: p.id, subject: p.title, worstCase, earlySign, guard }
  }

  return { holds, fragile, rehearsal, morningLine: parsed.morningLine }
}
