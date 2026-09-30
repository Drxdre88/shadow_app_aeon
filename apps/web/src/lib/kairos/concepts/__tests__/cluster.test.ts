import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  CONCEPT_MAX_SIZE,
  CONCEPT_MIN_SIZE,
  CONCEPT_SIM_THRESHOLD,
  clusterByCosine,
  cosineSimilarity,
  jaccard,
  matchExistingConcept,
  type ClusterItem,
} from '../cluster'

// Unit vector near axis `axis` (dimension 8) with a small deterministic wobble.
function near(axis: number, wobble: number, dims = 8): number[] {
  const v = new Array(dims).fill(0)
  v[axis] = 1
  v[(axis + 1) % dims] = wobble
  return v
}

const id = (n: number) => `m${String(n).padStart(3, '0')}`

// Random items clustered around a few axes so both merges and rejections occur.
const itemsArb = fc
  .array(
    fc.record({
      axis: fc.integer({ min: 0, max: 3 }),
      noise: fc.array(fc.double({ min: -0.35, max: 0.35, noNaN: true }), { minLength: 6, maxLength: 6 }),
    }),
    { minLength: 0, maxLength: 40 },
  )
  .map((raw) =>
    raw.map((r, i): ClusterItem => {
      const v = [0, 0, 0, 0, ...r.noise.slice(0, 4)]
      v[r.axis] = 1
      return { id: id(i), embedding: v }
    }),
  )

describe('clusterByCosine', () => {
  it('groups tight neighbourhoods and drops clusters below min size', () => {
    const items = [
      ...[0, 0.05, 0.1, 0.15, 0.2].map((w, i) => ({ id: `a${i}`, embedding: near(0, w) })),
      ...[0, 0.05, 0.1].map((w, i) => ({ id: `b${i}`, embedding: near(4, w) })),
    ]
    expect(clusterByCosine(items)).toEqual([['a0', 'a1', 'a2', 'a3', 'a4']])
  })

  it('never chains through a bridge: complete linkage keeps distant ends apart', () => {
    // Points on an arc: neighbours ≥ 0.82 but the ends are far apart.
    const items = Array.from({ length: 10 }, (_, i) => {
      const t = (i * Math.PI) / 18 // 10° steps
      return { id: id(i), embedding: [Math.cos(t), Math.sin(t)] }
    })
    for (const c of clusterByCosine(items, { minSize: 2 })) {
      for (const a of c) for (const b of c) {
        const ea = items.find((x) => x.id === a)!.embedding
        const eb = items.find((x) => x.id === b)!.embedding
        expect(cosineSimilarity(ea, eb)).toBeGreaterThanOrEqual(CONCEPT_SIM_THRESHOLD - 1e-12)
      }
    }
  })

  it('caps cluster size at max', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: id(i), embedding: near(0, i * 0.001) }))
    const clusters = clusterByCosine(items)
    expect(clusters.every((c) => c.length <= CONCEPT_MAX_SIZE)).toBe(true)
    expect(clusters.map((c) => c.length)).toEqual([12, 12, 6])
  })

  it('ignores duplicate ids and empty embeddings', () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: id(i), embedding: near(0, 0.01 * i) })),
      { id: id(0), embedding: near(3, 0) },
      { id: 'empty', embedding: [] },
    ]
    expect(clusterByCosine(items)).toEqual([[id(0), id(1), id(2), id(3)]])
  })

  it('property: deterministic under input permutation', () => {
    fc.assert(
      fc.property(itemsArb, fc.integer(), (items, seed) => {
        const shuffled = [...items].sort((a, b) => ((a.id.charCodeAt(3) * seed) % 7) - ((b.id.charCodeAt(3) * seed) % 7))
        expect(clusterByCosine(shuffled)).toEqual(clusterByCosine(items))
      }),
    )
  })

  it('property: each member in at most one cluster, sizes in bounds, threshold respected', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const clusters = clusterByCosine(items)
        const seen = new Set<string>()
        const emb = new Map(items.map((i) => [i.id, i.embedding]))
        for (const c of clusters) {
          expect(c.length).toBeGreaterThanOrEqual(CONCEPT_MIN_SIZE)
          expect(c.length).toBeLessThanOrEqual(CONCEPT_MAX_SIZE)
          for (const m of c) {
            expect(seen.has(m)).toBe(false)
            seen.add(m)
          }
          for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
            expect(cosineSimilarity(emb.get(c[i])!, emb.get(c[j])!)).toBeGreaterThanOrEqual(CONCEPT_SIM_THRESHOLD - 1e-12)
          }
        }
      }),
    )
  })
})

describe('matchExistingConcept', () => {
  it('picks the best overlap at or above the floor, ties by id', () => {
    const members = ['a', 'b', 'c', 'd', 'e']
    const existing = [
      { id: 'z', memberIds: ['a', 'b', 'c', 'd'] }, // 0.8
      { id: 'y', memberIds: ['a', 'b', 'c', 'd'] }, // 0.8 — wins tie on id
      { id: 'x', memberIds: ['a', 'b'] }, // 0.4
    ]
    expect(matchExistingConcept(members, existing)).toEqual({ id: 'y', overlap: 0.8 })
  })

  it('returns null below 0.6 overlap', () => {
    expect(matchExistingConcept(['a', 'b', 'c', 'd'], [{ id: 'x', memberIds: ['a', 'b', 'e', 'f'] }])).toBeNull()
  })

  it('jaccard is symmetric and bounded', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.array(fc.string()), (a, b) => {
        const j = jaccard(a, b)
        expect(j).toBe(jaccard(b, a))
        expect(j).toBeGreaterThanOrEqual(0)
        expect(j).toBeLessThanOrEqual(1)
      }),
    )
  })
})
