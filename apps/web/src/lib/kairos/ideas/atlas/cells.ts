import { IDEA_KINDS, IDEA_LEAPS, type IdeaKind, type IdeaLeap } from '../types'
import { ATLAS_CROSS_AREA } from '@/lib/data/validators/kairos-idea-atlas'

// Atlas cells (lane A): life area (Dominion id or 'cross') × idea kind × leap.
// The model declares kind and leap; the server picks the area from the
// evidence and checks a claimed far leap against it (verifyLeap).

export { ATLAS_CROSS_AREA }
export const FAR_LEAP_MAX_COSINE = 0.6

export interface AtlasCellRef {
  area: string
  kind: IdeaKind
  leap: IdeaLeap
}

export interface AtlasTag extends AtlasCellRef {
  cell: string
  leapClaimed: IdeaLeap | null
}

export const cellKey = (area: string, kind: IdeaKind, leap: IdeaLeap): string => `${area}|${kind}|${leap}`

export const isIdeaKind = (v: unknown): v is IdeaKind => typeof v === 'string' && (IDEA_KINDS as readonly string[]).includes(v)
export const isIdeaLeap = (v: unknown): v is IdeaLeap => typeof v === 'string' && (IDEA_LEAPS as readonly string[]).includes(v)

export function parseCellKey(key: string): AtlasCellRef | null {
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const [area, kind, leap] = parts
  return area && isIdeaKind(kind) && isIdeaLeap(leap) ? { area, kind, leap } : null
}

// Every cell of the grid for the given areas (+ the cross bucket), stable order.
export function allCells(areaIds: readonly string[]): AtlasCellRef[] {
  const out: AtlasCellRef[] = []
  for (const area of [...areaIds, ATLAS_CROSS_AREA]) {
    for (const kind of IDEA_KINDS) for (const leap of IDEA_LEAPS) out.push({ area, kind, leap })
  }
  return out
}

type EvidenceLookup = ReadonlyMap<string, { dominionId: string | null }>

// Dominions of the cited evidence, in citation order (duplicates kept).
function citedAreas(citedIds: readonly string[], evidence: EvidenceLookup, active: ReadonlySet<string>): string[] {
  return citedIds
    .map((id) => evidence.get(id)?.dominionId ?? null)
    .filter((d): d is string => d !== null && active.has(d))
}

export function majorityArea(areas: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const a of areas) counts.set(a, (counts.get(a) ?? 0) + 1)
  let best: string | null = null
  for (const [a, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = a
  return best
}

// A claimed far leap stands only when the evidence spans ≥2 Dominions or the
// idea sits far from everything archived; anything else is near.
export function verifyLeap(claimed: IdeaLeap | null, spannedAreas: number, maxCosine: number): IdeaLeap {
  if (claimed !== 'far') return 'near'
  return spannedAreas >= 2 || maxCosine < FAR_LEAP_MAX_COSINE ? 'far' : 'near'
}

export interface TagInput {
  kind?: IdeaKind
  leap?: IdeaLeap
  citedIds: readonly string[]
  direction: string
  maxCosine: number
}

export interface TagContext {
  evidence: EvidenceLookup
  directions: ReadonlyArray<{ label: string; dominion: string | null }>
  dominions: ReadonlyArray<{ id: string; name: string }>
}

// null when the model gave no valid kind (the candidate stays off the atlas).
export function tagCandidate(c: TagInput, ctx: TagContext): AtlasTag | null {
  if (!isIdeaKind(c.kind)) return null
  const active = new Set(ctx.dominions.map((d) => d.id))
  const areas = citedAreas(c.citedIds, ctx.evidence, active)
  let area = majorityArea(areas)
  if (!area) {
    const declared = ctx.directions.find((d) => d.label === c.direction)?.dominion?.trim().toLowerCase()
    area = (declared && ctx.dominions.find((d) => d.name.trim().toLowerCase() === declared)?.id) || ATLAS_CROSS_AREA
  }
  const leapClaimed = isIdeaLeap(c.leap) ? c.leap : null
  const leap = verifyLeap(leapClaimed, new Set(areas).size, c.maxCosine)
  return { cell: cellKey(area, c.kind, leap), area, kind: c.kind, leap, leapClaimed }
}
