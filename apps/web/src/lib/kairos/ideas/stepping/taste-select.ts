import type { SelectionInput, SelectionResult } from '@/lib/kairos/ideas/select'
import { ELO_START, IDEA_SURVIVORS_MAX } from '@/lib/kairos/ideas/types'

// Taste re-ranking after the base selection: two taste slots + one reserved surprise slot.

export const TASTE_WEIGHT = 60
export const SURPRISE_SCORE_FLOOR = 950
export const OFF_TASTE_FIT = -0.15

export type TastePickKind = 'taste' | 'surprise'

export interface TasteSelectOptions {
  max?: number
  // Quality floor past the base's top-ranked idea (same rule as selectSurvivors).
  floor?: number
  surpriseFloor?: number
  weight?: number
  scoreOf?: (c: SelectionInput) => number
}

export interface TasteSelection {
  selection: SelectionResult[]
  picks: Map<string, TastePickKind>
}

const eloScore = (c: SelectionInput) => c.record?.elo ?? ELO_START

export function applyTasteSelection(
  base: readonly SelectionResult[],
  inputs: readonly SelectionInput[],
  fitByKey: ReadonlyMap<string, number | null>,
  opts: TasteSelectOptions = {},
): TasteSelection {
  const max = opts.max ?? IDEA_SURVIVORS_MAX
  const floor = opts.floor ?? ELO_START
  const surpriseFloor = opts.surpriseFloor ?? SURPRISE_SCORE_FLOOR
  const weight = opts.weight ?? TASTE_WEIGHT
  const scoreOf = opts.scoreOf ?? eloScore
  const inputOf = new Map(inputs.map((c) => [c.key, c]))
  const viable = base.filter((s) => s.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const picks = new Map<string, TastePickKind>()
  if (viable.length === 0 || max < 1) return { selection: [...base], picks }

  const score = (key: string) => {
    const c = inputOf.get(key)
    return c ? scoreOf(c) : ELO_START
  }
  const fit = (key: string) => fitByKey.get(key) ?? null
  const top = viable[0].key
  const allowed = (key: string) => key === top || score(key) >= floor
  const adjusted = (key: string) => score(key) + weight * (fit(key) ?? 0)
  const byAdjusted = [...viable].sort((a, b) => adjusted(b.key) - adjusted(a.key) || (a.rank ?? 0) - (b.rank ?? 0))

  const tasteSlots = max - 1
  for (const s of byAdjusted) {
    if (picks.size >= tasteSlots) break
    if (allowed(s.key)) picks.set(s.key, 'taste')
  }
  const surprise = viable
    .filter((s) => !picks.has(s.key) && score(s.key) >= surpriseFloor)
    .filter((s) => {
      const f = fit(s.key)
      return f === null || f <= OFF_TASTE_FIT
    })
    .sort((a, b) => score(b.key) - score(a.key) || (a.rank ?? 0) - (b.rank ?? 0))[0]
  if (surprise) picks.set(surprise.key, 'surprise')
  else {
    const next = byAdjusted.find((s) => !picks.has(s.key) && allowed(s.key))
    if (next) picks.set(next.key, 'taste')
  }

  const order = [...picks.keys(), ...viable.map((s) => s.key).filter((k) => !picks.has(k))]
  const rankOf = new Map(order.map((k, i) => [k, i + 1]))
  const selection = base.map((s): SelectionResult => {
    if (s.rank === null) return s
    const survives = picks.has(s.key)
    return { key: s.key, status: survives ? 'survivor' : 'eliminated', eliminatedReason: survives ? null : 'ranked_out', rank: rankOf.get(s.key) ?? s.rank }
  })
  return { selection, picks }
}
