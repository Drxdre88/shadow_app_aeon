import type { GroundedGenerate } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaCandidate } from '@/lib/kairos/ideas/types'
import { checkStructure, parseBlends, type StructureFailure } from './mapping'
import type { BridgeMeta, CollisionContext } from './types'

// Structure gate on the parsed generate answer (`on` mode). A candidate that
// claims a blend must name an offered pair, cite both of its ids and carry a
// blend that passes checkStructure; otherwise it is dropped. One candidate per
// pair; survivors get a BridgeMeta keyed by their (renumbered) key.

export type GateDropReason = StructureFailure | 'unknown_pair' | 'duplicate_pair' | 'missing_citation' | 'no_blend'

export interface CollisionGateStats {
  offered: number
  blends: number
  declined: number
  kept: number
  dropped: Partial<Record<GateDropReason, number>>
}

export interface CollisionGateResult {
  grounded: GroundedGenerate
  bridges: Map<string, BridgeMeta>
  stats: CollisionGateStats
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export function applyCollisionGate(grounded: GroundedGenerate, collision: CollisionContext, raw: unknown): CollisionGateResult {
  const blends = parseBlends(raw)
  const pairs = new Map(collision.pairs.map((p) => [p.id, p]))
  const stats: CollisionGateStats = {
    offered: collision.pairs.length,
    blends: 0,
    declined: [...blends.values()].filter((b) => !b.holds).length,
    kept: 0,
    dropped: {},
  }
  const drop = (reason: GateDropReason) => {
    stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1
  }
  const used = new Set<string>()
  const kept: Array<{ c: IdeaCandidate; bridge: BridgeMeta | null }> = []
  for (const c of grounded.candidates) {
    if (c.blend === undefined) {
      kept.push({ c, bridge: null })
      continue
    }
    stats.blends++
    const pair = pairs.get(c.blend)
    if (!pair) { drop('unknown_pair'); continue }
    if (used.has(pair.id)) { drop('duplicate_pair'); continue }
    if (!c.citedIds.includes(pair.aId) || !c.citedIds.includes(pair.bId)) { drop('missing_citation'); continue }
    const blend = blends.get(pair.id)
    if (!blend) { drop('no_blend'); continue }
    const check = checkStructure(blend, pair.aText, pair.bText)
    if (!check.ok) { drop(check.reason); continue }
    used.add(pair.id)
    stats.kept++
    kept.push({
      c,
      bridge: {
        v: 1,
        pairKey: pair.pairKey,
        aId: pair.aId,
        bId: pair.bId,
        aArea: pair.aArea,
        bArea: pair.bArea,
        cos: round3(pair.cos),
        relations: check.relations,
        map: blend.map.map((m) => ({ a: m.a, b: m.b })),
        insight: blend.insight,
        mappingHolds: null,
      },
    })
  }
  if (kept.length === grounded.candidates.length) {
    const bridges = new Map(kept.flatMap(({ c, bridge }) => (bridge ? [[c.key, bridge] as const] : [])))
    return { grounded, bridges, stats }
  }
  const bridges = new Map<string, BridgeMeta>()
  const candidates = kept.map(({ c, bridge }, i) => {
    const key = `c${i + 1}`
    if (bridge) bridges.set(key, bridge)
    return { ...c, key }
  })
  return { grounded: { ...grounded, candidates }, bridges, stats }
}
