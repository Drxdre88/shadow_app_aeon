import { z } from 'zod'
import { jaccard, norm, tokens } from './text'

// Deterministic structure check for a generator blend (structure-mapping):
// it proves the model STATED a consistent relational mapping, not that the
// mapping is true; the judge confirms that separately.

export const BLEND_RELATIONS_MIN = 2
export const BLEND_RELATIONS_MAX = 6
export const BLEND_MATCHED_MIN = 2
export const BLEND_LABEL_JACCARD_MAX = 0.5
const ENTITY_TOKEN_MIN = 4

const word = (max: number) => z.string().trim().min(1).max(max)
const relationSchema = z.object({ rel: word(60), x: word(80), y: word(80) })

export const blendSchema = z.object({
  pair: word(20),
  holds: z.boolean(),
  a: z.array(relationSchema).max(12).default([]),
  b: z.array(relationSchema).max(12).default([]),
  map: z.array(z.object({ a: word(80), b: word(80) })).max(12).default([]),
  insight: z.string().trim().max(400).default(''),
})
export type Blend = z.infer<typeof blendSchema>
type Relation = z.infer<typeof relationSchema>

// First valid blend per pair id from the raw JSON's top-level "blends".
export function parseBlends(raw: unknown): Map<string, Blend> {
  const list = raw && typeof raw === 'object' ? (raw as { blends?: unknown }).blends : undefined
  const out = new Map<string, Blend>()
  if (!Array.isArray(list)) return out
  for (const item of list) {
    const parsed = blendSchema.safeParse(item)
    if (parsed.success && !out.has(parsed.data.pair)) out.set(parsed.data.pair, parsed.data)
  }
  return out
}

// The "blend" pair id on one raw candidate item, or null.
export function blendOf(rawItem: unknown): string | null {
  const v = rawItem && typeof rawItem === 'object' ? (rawItem as { blend?: unknown }).blend : undefined
  if (typeof v !== 'string') return null
  const id = v.trim()
  return id.length > 0 && id.length <= 20 ? id : null
}

export type StructureFailure =
  | 'declined'
  | 'relation_count'
  | 'relation_shape'
  | 'map_not_one_to_one'
  | 'parallel_connectivity'
  | 'not_systematic'
  | 'surface_match'
  | 'ungrounded_entities'
  | 'no_insight'

export type StructureResult =
  | { ok: true; relations: Array<{ a: string; b: string }> }
  | { ok: false; reason: StructureFailure }

const relText = (r: Relation) => `${r.x} ${r.rel} ${r.y}`

function connected(edges: ReadonlyArray<[string, string]>): boolean {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  for (const [x, y] of edges) {
    if (!parent.has(x)) parent.set(x, x)
    if (!parent.has(y)) parent.set(y, y)
    parent.set(find(x), find(y))
  }
  return new Set([...parent.keys()].map(find)).size === 1
}

function groundedIn(relations: readonly Relation[], text: string): boolean {
  const source = tokens(text, ENTITY_TOKEN_MIN)
  return relations.some((r) => [...tokens(`${r.x} ${r.y}`, ENTITY_TOKEN_MIN)].some((t) => source.has(t)))
}

export function checkStructure(blend: Blend, textA: string, textB: string): StructureResult {
  if (!blend.holds) return { ok: false, reason: 'declined' }
  const inRange = (n: number) => n >= BLEND_RELATIONS_MIN && n <= BLEND_RELATIONS_MAX
  if (!inRange(blend.a.length) || !inRange(blend.b.length)) return { ok: false, reason: 'relation_count' }
  if ([...blend.a, ...blend.b].some((r) => norm(r.x) === norm(r.y))) return { ok: false, reason: 'relation_shape' }

  const forward = new Map<string, string>()
  const backward = new Set<string>()
  for (const m of blend.map) {
    const a = norm(m.a)
    const b = norm(m.b)
    if (forward.has(a) || backward.has(b)) return { ok: false, reason: 'map_not_one_to_one' }
    forward.set(a, b)
    backward.add(b)
  }
  if (forward.size === 0) return { ok: false, reason: 'map_not_one_to_one' }

  const usedB = new Set<number>()
  const matched: Array<{ a: Relation; b: Relation }> = []
  for (const ra of blend.a) {
    const x = forward.get(norm(ra.x))
    const y = forward.get(norm(ra.y))
    if (!x || !y) continue
    const j = blend.b.findIndex((rb, i) => !usedB.has(i) && norm(rb.x) === x && norm(rb.y) === y)
    if (j < 0) continue
    usedB.add(j)
    matched.push({ a: ra, b: blend.b[j] })
  }
  if (matched.length < BLEND_MATCHED_MIN) return { ok: false, reason: 'parallel_connectivity' }
  if (!connected(matched.map(({ a }) => [norm(a.x), norm(a.y)] as [string, string]))) return { ok: false, reason: 'not_systematic' }

  const sims = [...forward].map(([a, b]) => (a === b ? 1 : jaccard(tokens(a, 1), tokens(b, 1))))
  if (sims.reduce((s, v) => s + v, 0) / sims.length >= BLEND_LABEL_JACCARD_MAX) return { ok: false, reason: 'surface_match' }

  if (!groundedIn(blend.a, textA) || !groundedIn(blend.b, textB)) return { ok: false, reason: 'ungrounded_entities' }
  if (!blend.insight) return { ok: false, reason: 'no_insight' }
  return { ok: true, relations: matched.map(({ a, b }) => ({ a: relText(a), b: relText(b) })) }
}
