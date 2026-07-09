import { describe, it, expect, beforeEach, vi } from 'vitest'

// Belief trail — supersession lineage read-path. Pins the predecessor/
// successor walk against the linear, branching, and cyclic shapes
// supersededById can take (it's a soft pointer, no FK).

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
    },
  }
})

import { getBeliefTrail } from '../memories'

const USER = 'user-1'

function row(id: string, opts: Partial<{
  createdAt: Date
  supersededAt: Date | null
  supersededById: string | null
  confidence: number | null
  aiTitle: string | null
}> = {}) {
  return {
    id,
    title: `title-${id}`,
    aiTitle: opts.aiTitle ?? null,
    confidence: opts.confidence ?? 0.5,
    createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    supersededAt: opts.supersededAt ?? null,
    supersededById: opts.supersededById ?? null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
})

describe('getBeliefTrail', () => {
  it('returns null when the target memory does not exist', async () => {
    selectQueue.push([]) // target lookup
    const trail = await getBeliefTrail('missing', USER)
    expect(trail).toBeNull()
  })

  it('returns null when the target belongs to a different user', async () => {
    // findMemoryById is user-scoped in the WHERE clause; the mock can't
    // enforce that filter, so this pins the empty-result shape a wrong-user
    // lookup produces.
    selectQueue.push([])
    const trail = await getBeliefTrail('mem-1', 'other-user')
    expect(trail).toBeNull()
  })

  it('resolves a linear chain A→B→C (C current) oldest to newest', async () => {
    const a = row('a', { createdAt: new Date('2026-01-01'), supersededAt: new Date('2026-01-02'), supersededById: 'b' })
    const b = row('b', { createdAt: new Date('2026-01-02'), supersededAt: new Date('2026-01-03'), supersededById: 'c' })
    const c = row('c', { createdAt: new Date('2026-01-03'), supersededAt: null, supersededById: null })

    selectQueue.push([b])   // target lookup (B)
    selectQueue.push([c])   // successor of B — walked first so the live tip is always present
    selectQueue.push([a])   // predecessors of B
    selectQueue.push([])    // predecessors of A → none

    const trail = await getBeliefTrail('b', USER)
    expect(trail).not.toBeNull()
    expect(trail!.map((n) => n.id)).toEqual(['a', 'b', 'c'])

    const [na, nb, nc] = trail!
    expect(na.isCurrent).toBe(false)
    expect(na.invalidFrom).toEqual(a.supersededAt)
    expect(nb.isCurrent).toBe(false)
    expect(nb.invalidFrom).toEqual(b.supersededAt)
    expect(nb.isTarget).toBe(true)
    expect(nc.isCurrent).toBe(true)
    expect(nc.invalidFrom).toBeNull()
  })

  it('handles a branch — two predecessors superseded by one node', async () => {
    const target = row('t', { createdAt: new Date('2026-01-03'), supersededAt: null, supersededById: null })
    const p1 = row('p1', { createdAt: new Date('2026-01-01'), supersededAt: new Date('2026-01-03'), supersededById: 't' })
    const p2 = row('p2', { createdAt: new Date('2026-01-02'), supersededAt: new Date('2026-01-03'), supersededById: 't' })

    selectQueue.push([target]) // target lookup
    selectQueue.push([p1, p2]) // predecessors of target
    selectQueue.push([])       // predecessors of p1/p2 → none

    const trail = await getBeliefTrail('t', USER)
    expect(trail).not.toBeNull()
    expect(trail!.map((n) => n.id)).toEqual(['p1', 'p2', 't'])
    expect(trail!.find((n) => n.id === 't')!.isCurrent).toBe(true)
  })

  it('prefers real valid-time columns over transaction-time fallbacks', async () => {
    // Bi-temporal: a belief true in the world before we recorded it, and expired
    // (invalid_at) without a superseding successor — supersededAt stays null.
    const validAt = new Date('2025-12-01')
    const invalidAt = new Date('2026-02-15')
    const t = { ...row('t', { supersededAt: null, supersededById: null }), validAt, invalidAt }

    selectQueue.push([t]) // target lookup
    selectQueue.push([])  // predecessors → none

    const trail = await getBeliefTrail('t', USER)
    const n = trail![0]
    expect(n.validFrom).toEqual(validAt)      // not createdAt
    expect(n.invalidFrom).toEqual(invalidAt)  // not supersededAt (which is null)
    // A still-live tip (never superseded) is current even though it has expired
    // in valid-time — isCurrent tracks the supersession chain, not the window.
    expect(n.isCurrent).toBe(true)
  })

  it('terminates on a mutual cycle A↔B without infinite looping', async () => {
    const a = row('a', { createdAt: new Date('2026-01-01'), supersededAt: new Date('2026-01-02'), supersededById: 'b' })
    const b = row('b', { createdAt: new Date('2026-01-02'), supersededAt: new Date('2026-01-01'), supersededById: 'a' })

    selectQueue.push([a])   // target lookup (A)
    selectQueue.push([b])   // predecessors of A → B (B.supersededById === 'a')
    selectQueue.push([a])   // predecessors of B → A, filtered out as already visited

    const trail = await getBeliefTrail('a', USER)
    expect(trail).not.toBeNull()
    expect(trail!.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})
