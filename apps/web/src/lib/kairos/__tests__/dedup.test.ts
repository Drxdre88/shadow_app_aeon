import { describe, it, expect } from 'vitest'
import { buildClusters, pickCanonical, type DedupCandidate } from '../dedup'

describe('buildClusters', () => {
  it('groups a simple pair', () => {
    expect(buildClusters([['a', 'b']])).toEqual([['a', 'b'].sort()])
  })

  it('collapses a transitive chain into one cluster', () => {
    // a~b, b~c  →  {a,b,c}
    const clusters = buildClusters([['a', 'b'], ['b', 'c']])
    expect(clusters).toHaveLength(1)
    expect([...clusters[0]].sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps disjoint duplicate sets separate', () => {
    const clusters = buildClusters([['a', 'b'], ['x', 'y']])
    expect(clusters).toHaveLength(2)
    const flat = clusters.map((c) => [...c].sort())
    expect(flat).toContainEqual(['a', 'b'])
    expect(flat).toContainEqual(['x', 'y'])
  })

  it('returns nothing when there are no pairs', () => {
    expect(buildClusters([])).toEqual([])
  })
})

describe('pickCanonical', () => {
  const at = (iso: string) => new Date(iso)
  const cand = (id: string, o: Partial<DedupCandidate> = {}): DedupCandidate => ({
    id,
    pinned: o.pinned ?? false,
    confidence: o.confidence ?? null,
    createdAt: o.createdAt ?? at('2026-01-01T00:00:00Z'),
  })

  it('prefers the pinned row even if older / lower confidence', () => {
    const r = pickCanonical([
      cand('new', { createdAt: at('2026-06-01T00:00:00Z'), confidence: 0.9 }),
      cand('pinned', { pinned: true, createdAt: at('2026-01-01T00:00:00Z'), confidence: 0.1 }),
    ])
    expect(r.canonicalId).toBe('pinned')
    expect(r.loserIds).toEqual(['new'])
  })

  it('prefers higher confidence when pinned is equal', () => {
    const r = pickCanonical([
      cand('low', { confidence: 0.2 }),
      cand('high', { confidence: 0.8 }),
    ])
    expect(r.canonicalId).toBe('high')
    expect(r.loserIds).toEqual(['low'])
  })

  it('falls back to newest when pinned + confidence tie', () => {
    const r = pickCanonical([
      cand('older', { createdAt: at('2026-01-01T00:00:00Z'), confidence: 0.5 }),
      cand('newer', { createdAt: at('2026-06-01T00:00:00Z'), confidence: 0.5 }),
    ])
    expect(r.canonicalId).toBe('newer')
    expect(r.loserIds).toEqual(['older'])
  })

  it('treats null confidence as 0', () => {
    const r = pickCanonical([
      cand('hasConf', { confidence: 0.3 }),
      cand('noConf', { confidence: null }),
    ])
    expect(r.canonicalId).toBe('hasConf')
  })
})
