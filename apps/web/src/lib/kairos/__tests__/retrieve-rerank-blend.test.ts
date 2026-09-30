import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hybrid substrate path (embeddings ON) — covers the final ordering after the
// Voyage rerank and the vector-error fallback. db.select serves the FTS leg;
// db.transaction serves the vector leg.

const ftsQueue: unknown[][] = []
const vecQueue: unknown[][] = []
let transactionImpl: (() => Promise<unknown[]>) | null = null

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(ftsQueue.shift() ?? [])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        if (transactionImpl) return transactionImpl()
        const tx = {
          execute: vi.fn(async () => undefined),
          select: vi.fn(() => makeChain(vecQueue.shift() ?? [])),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('@/lib/data/dominions', () => ({ inspectDominion: vi.fn() }))

vi.mock('../embeddings', () => ({
  embeddingsEnabled: () => true,
  embedOne: vi.fn(async () => [0.1, 0.2]),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

vi.mock('../rerank', () => ({ rerankScored: vi.fn() }))

import { searchSubstrateForChat } from '../retrieve'
import { rerankScored } from '../rerank'

const TODAY_ID = 'a1111111-1111-4111-8111-111111111111'
const STALE_ID = 'a2222222-2222-4222-8222-222222222222'
const REFL_ID = 'a3333333-3333-4333-8333-333333333333'

function sub(id: string, streamClass: string, createdAt: Date, rank = 0.1, standing: number | null = null) {
  return {
    id,
    title: id,
    bodyMd: 'body',
    streamClass,
    createdAt,
    updatedAt: createdAt,
    confidence: null,
    pinned: false,
    standing,
    rank,
  }
}

const now = new Date()
const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000)

beforeEach(() => {
  vi.clearAllMocks()
  ftsQueue.length = 0
  vecQueue.length = 0
  transactionImpl = null
})

describe('fetchSubstrate — rerank blended with recency + confidence', () => {
  it('a same-day row beats a 60-day-old row with slightly higher rerank relevance', async () => {
    const stale = sub(STALE_ID, 'idea', sixtyDaysAgo)
    const today = sub(TODAY_ID, 'idea', now)
    ftsQueue.push([stale, today])
    vecQueue.push([stale, today])
    // Relevance-only ordering would put STALE first (0.8 > 0.7).
    vi.mocked(rerankScored).mockImplementation(async (_q, items) => {
      const byId = new Map((items as typeof stale[]).map((i) => [i.id, i]))
      return [
        { item: byId.get(STALE_ID)!, relevance: 0.8 },
        { item: byId.get(TODAY_ID)!, relevance: 0.7 },
      ] as never
    })

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out.map((m) => m.id)).toEqual([TODAY_ID, STALE_ID])
    // Whole pool is scored so every candidate has a relevance to blend.
    expect(vi.mocked(rerankScored).mock.calls[0][3]).toBeUndefined()
  })

  it('a much stronger rerank match still wins over a fresh weak one', async () => {
    const stale = sub(STALE_ID, 'idea', sixtyDaysAgo)
    const today = sub(TODAY_ID, 'idea', now)
    ftsQueue.push([stale, today])
    vecQueue.push([stale, today])
    vi.mocked(rerankScored).mockImplementation(async (_q, items) => {
      const byId = new Map((items as typeof stale[]).map((i) => [i.id, i]))
      return [
        { item: byId.get(STALE_ID)!, relevance: 0.9 },
        { item: byId.get(TODAY_ID)!, relevance: 0.3 },
      ] as never
    })

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out[0].id).toBe(STALE_ID)
  })

  it('reflections win exact blended-score ties', async () => {
    const idea = sub(TODAY_ID, 'idea', now)
    const refl = sub(REFL_ID, 'reflection', now)
    ftsQueue.push([idea, refl])
    vecQueue.push([idea, refl])
    vi.mocked(rerankScored).mockImplementation(async (_q, items) => {
      const byId = new Map((items as typeof idea[]).map((i) => [i.id, i]))
      return [
        { item: byId.get(TODAY_ID)!, relevance: 0.5 },
        { item: byId.get(REFL_ID)!, relevance: 0.5 },
      ] as never
    })

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out[0].id).toBe(REFL_ID)
  })

  it('no Voyage (rerank null) keeps the recency/confidence-weighted RRF pool order', async () => {
    const stale = sub(STALE_ID, 'idea', sixtyDaysAgo)
    const today = sub(TODAY_ID, 'idea', now)
    // Stale leads both legs (RRF 2/61 vs 2/62, ~1.6% apart); recency (×1.3 vs
    // ×~1.015) flips that, exactly as before rerank blending existed.
    ftsQueue.push([stale, today])
    vecQueue.push([stale, today])
    vi.mocked(rerankScored).mockResolvedValue(null)

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out.map((m) => m.id)).toEqual([TODAY_ID, STALE_ID])
  })
})

describe('fetchSubstrate — memory-engine standing (relevance × standingFactor)', () => {
  it('a scored high-standing stale row beats a fresh low-standing one at equal relevance', async () => {
    const trusted = sub(STALE_ID, 'idea', sixtyDaysAgo, 0.1, 0.9)
    const weak = sub(TODAY_ID, 'idea', now, 0.1, 0.1)
    ftsQueue.push([weak, trusted])
    vecQueue.push([weak, trusted])
    vi.mocked(rerankScored).mockImplementation(async (_q, items) =>
      (items as typeof weak[]).map((item) => ({ item, relevance: 0.6 })) as never)

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    // P0 (recency) would put TODAY first; standing 0.9 vs 0.1 decides now.
    expect(out.map((m) => m.id)).toEqual([STALE_ID, TODAY_ID])
  })

  it('standing also shapes the no-Voyage pool order', async () => {
    const trusted = sub(STALE_ID, 'idea', sixtyDaysAgo, 0.1, 0.9)
    const weak = sub(TODAY_ID, 'idea', now, 0.1, 0.1)
    ftsQueue.push([weak, trusted])
    vecQueue.push([weak, trusted])
    vi.mocked(rerankScored).mockResolvedValue(null)

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out.map((m) => m.id)).toEqual([STALE_ID, TODAY_ID])
  })

  it('concept rows are retrievable and keep their streamClass', async () => {
    const CONCEPT_ID = 'a4444444-4444-4444-8444-444444444444'
    const concept = sub(CONCEPT_ID, 'concept', sixtyDaysAgo, 0.1, 0.75)
    ftsQueue.push([concept])
    vecQueue.push([concept])
    vi.mocked(rerankScored).mockResolvedValue(null)

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out).toEqual([expect.objectContaining({ id: CONCEPT_ID, streamClass: 'concept' })])
  })
})

describe('fetchSubstrate — vector-leg error fallback', () => {
  it('re-weights FTS rows by recency instead of returning raw lexical order', async () => {
    const stale = sub(STALE_ID, 'idea', sixtyDaysAgo, 0.115)
    const today = sub(TODAY_ID, 'idea', now, 0.10)
    ftsQueue.push([stale, today]) // raw SQL order: stale first
    transactionImpl = async () => {
      throw new Error('vector index unavailable')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await searchSubstrateForChat('user-1', 'launch plan status')

    expect(out.map((m) => m.id)).toEqual([TODAY_ID, STALE_ID])
    expect(rerankScored).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('honours the caller topK on the fallback path (not the default 5)', async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      sub(`b000000${i}-0000-4000-8000-000000000000`, 'idea', now, 0.1 - i * 0.001))
    ftsQueue.push(rows)
    transactionImpl = async () => {
      throw new Error('boom')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await searchSubstrateForChat('user-1', 'launch plan status', 8)

    expect(out).toHaveLength(8)
    warn.mockRestore()
  })
})
