import { IDEA_KINDS, IDEA_LEAPS, IDEA_MOVES } from '@/lib/kairos/ideas/types'
import { asRecord, ideaOf, rowOutcome, str, type IdeaRowLike } from './stones'

// Learned owner taste, recomputed on read from idea rows (no stored copy). Never enters any prompt.

export const TASTE_WINDOW_DAYS = 90
export const TASTE_HALF_LIFE_DAYS = 30
export const TASTE_MIN_DECISIONS = 6
export const TASTE_PRIOR = 3
export const TASTE_CONFIDENT_N = 1.5
export const TASTE_IGNORED_WEIGHT = 0.35
const LIFT_MIN = 0.5
const LIFT_MAX = 2
const BASE_MIN = 0.05
const BASE_MAX = 0.95
const DAY_MS = 86_400_000

export const TASTE_DIMENSIONS = ['area', 'move', 'kind', 'leap', 'length'] as const
export type TasteDimension = (typeof TASTE_DIMENSIONS)[number]
export type TasteFeatures = Partial<Record<TasteDimension, string>>

export interface TasteCell {
  value: string
  label: string
  accepted: number
  dismissed: number
  ignored: number
  weight: number
  lift: number
  confident: boolean
}

export interface IdeaTasteProfile {
  v: 1
  computedAt: string
  windowDays: number
  halfLifeDays: number
  active: boolean
  totals: { accepted: number; dismissed: number; ignored: number; baseRate: number | null }
  features: Record<TasteDimension, TasteCell[]>
  summary: string[]
  surprise: { slots: 1; rule: string }
}

export const SURPRISE_RULE = 'The third slot goes to the best idea off your usual taste (or unlike anything you have judged), if it scores at least 950.'
export const CROSS_CUTTING = 'cross-cutting'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined

export function leapFromCosine(maxCosine: unknown): string | undefined {
  if (typeof maxCosine !== 'number' || !Number.isFinite(maxCosine)) return undefined
  if (maxCosine >= 0.65) return 'near'
  if (maxCosine < 0.5) return 'far'
  return 'mid'
}

export function lengthOf(claim: string): string {
  const n = claim.trim().length
  return n < 120 ? 'short' : n < 240 ? 'medium' : 'long'
}

export interface FeatureSource {
  dominionId: string | null
  claim: string
  move?: unknown
  kind?: unknown
  leap?: unknown
  maxCosine?: unknown
}

export function featuresOf(src: FeatureSource): TasteFeatures {
  const out: TasteFeatures = { area: src.dominionId ?? CROSS_CUTTING, length: lengthOf(src.claim) }
  const move = oneOf(IDEA_MOVES, src.move)
  const kind = oneOf(IDEA_KINDS, src.kind)
  const leap = oneOf(IDEA_LEAPS, src.leap) ?? leapFromCosine(src.maxCosine)
  if (move) out.move = move
  if (kind) out.kind = kind
  if (leap) out.leap = leap
  return out
}

export function featuresOfRow(row: IdeaRowLike): TasteFeatures {
  const idea = ideaOf(row)
  const atlas = asRecord(idea.atlas)
  return featuresOf({
    dominionId: row.dominionId ?? null,
    claim: str(idea.claim) ?? '',
    move: idea.move,
    kind: atlas.kind ?? idea.kind,
    leap: atlas.leap ?? idea.leap,
    maxCosine: asRecord(idea.novelty).maxCosine,
  })
}

interface Tally { accepted: number; dismissed: number; ignored: number; pos: number; neg: number }
const emptyTally = (): Tally => ({ accepted: 0, dismissed: 0, ignored: 0, pos: 0, neg: 0 })

function phrase(dim: TasteDimension, label: string): string {
  if (dim === 'area') return `ideas about ${label}`
  if (dim === 'move') return `"${label}" ideas`
  if (dim === 'leap') return `${label}-leap ideas`
  return `${label} ideas`
}

export function computeIdeaTaste(
  rows: readonly IdeaRowLike[],
  now: Date,
  names: ReadonlyMap<string, string> = new Map(),
): IdeaTasteProfile {
  const total = emptyTally()
  const cells = new Map<TasteDimension, Map<string, Tally>>(TASTE_DIMENSIONS.map((d) => [d, new Map()]))
  for (const row of rows) {
    const { signal, by } = rowOutcome(row, now, { pendingIgnored: true })
    if (!signal || (signal === 'accepted' && by === 'agent')) continue
    const ageDays = Math.max(0, (now.getTime() - row.createdAt.getTime()) / DAY_MS)
    if (ageDays > TASTE_WINDOW_DAYS) continue
    const w = Math.pow(0.5, ageDays / TASTE_HALF_LIFE_DAYS)
    const features = featuresOfRow(row)
    const touched = [total]
    for (const d of TASTE_DIMENSIONS) {
      const v = features[d]
      if (!v) continue
      const byValue = cells.get(d)!
      const cell = byValue.get(v) ?? emptyTally()
      byValue.set(v, cell)
      touched.push(cell)
    }
    for (const t of touched) {
      t[signal]++
      if (signal === 'accepted') t.pos += w
      else t.neg += signal === 'dismissed' ? w : TASTE_IGNORED_WEIGHT * w
    }
  }
  const decisions = total.accepted + total.dismissed
  const raw = total.pos + total.neg > 0 ? total.pos / (total.pos + total.neg) : null
  const base = raw === null ? null : clamp(raw, BASE_MIN, BASE_MAX)
  const labelOf = (d: TasteDimension, v: string) =>
    d !== 'area' ? v : v === CROSS_CUTTING ? CROSS_CUTTING : names.get(v) ?? 'a retired area'
  const features = {} as Record<TasteDimension, TasteCell[]>
  const notable: Array<{ dim: TasteDimension; cell: TasteCell }> = []
  for (const d of TASTE_DIMENSIONS) {
    features[d] = [...cells.get(d)!.entries()].map(([value, t]) => {
      const n = t.pos + t.neg
      const lift = base === null ? 1 : clamp((t.pos + TASTE_PRIOR * base) / (n + TASTE_PRIOR) / base, LIFT_MIN, LIFT_MAX)
      const cell = { value, label: labelOf(d, value), accepted: t.accepted, dismissed: t.dismissed, ignored: t.ignored, weight: r3(n), lift: r3(lift), confident: n >= TASTE_CONFIDENT_N }
      if (cell.confident) notable.push({ dim: d, cell })
      return cell
    }).sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value))
  }
  const active = decisions >= TASTE_MIN_DECISIONS
  const summary = active
    ? notable
      .filter(({ cell }) => cell.lift >= 1.25 || cell.lift <= 0.8)
      .sort((a, b) => Math.abs(Math.log2(b.cell.lift)) - Math.abs(Math.log2(a.cell.lift)) || a.cell.value.localeCompare(b.cell.value))
      .slice(0, 5)
      .map(({ dim, cell }) => `You tend to ${cell.lift > 1 ? 'accept' : 'pass on'} ${phrase(dim, cell.label)}.`)
    : [`Not enough of your own decisions yet (${decisions} of ${TASTE_MIN_DECISIONS}).`]
  return {
    v: 1,
    computedAt: now.toISOString(),
    windowDays: TASTE_WINDOW_DAYS,
    halfLifeDays: TASTE_HALF_LIFE_DAYS,
    active,
    totals: { accepted: total.accepted, dismissed: total.dismissed, ignored: total.ignored, baseRate: base === null ? null : r3(base) },
    features,
    summary,
    surprise: { slots: 1, rule: SURPRISE_RULE },
  }
}

// Mean log2(lift) over confident matching cells, in [-1, 1]; null = unseen taste.
export function tasteFit(features: TasteFeatures, profile: IdeaTasteProfile): number | null {
  const logs: number[] = []
  for (const d of TASTE_DIMENSIONS) {
    const v = features[d]
    if (!v) continue
    const cell = profile.features[d].find((c) => c.value === v)
    if (cell?.confident) logs.push(Math.log2(cell.lift))
  }
  return logs.length === 0 ? null : r3(logs.reduce((a, b) => a + b, 0) / logs.length)
}
