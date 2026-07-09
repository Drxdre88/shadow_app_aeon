import { describe, it, expect, beforeEach, vi } from 'vitest'

// findSimilarBeliefs — contradiction-detection candidate retrieval. The
// self/archived/superseded/non-belief-type exclusions and the same-dominion-
// or-null scope are enforced in the WHERE clause itself (mirrors
// fetchSubstrate/dedupMemories, which are integration-level like this one —
// there's no dedicated unit test for their SQL predicates either; only the
// two branches below are meaningfully mockable at this layer).

const selectQueue: unknown[][] = []
let txSelectRows: unknown[] = []
let txLimitArg: number | null = null
let transactionCalled = false

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
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalled = true
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: () => {
            const chain: Record<string, unknown> = {}
            const pass = () => chain
            chain.from = pass
            chain.where = pass
            chain.orderBy = pass
            chain.limit = (n: number) => {
              txLimitArg = n
              return chain
            }
            chain.then = (resolve: (v: unknown[]) => unknown) => resolve(txSelectRows)
            return chain
          },
        }
        return fn(tx)
      }),
    },
  }
})

import { findSimilarBeliefs } from '../memories'

const USER = 'user-1'
const MEMORY_ID = 'mem-1'

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  txSelectRows = []
  txLimitArg = null
  transactionCalled = false
})

describe('findSimilarBeliefs', () => {
  it('returns [] without opening a transaction when the target has no stored embedding', async () => {
    selectQueue.push([{ embedding: null, dominionId: null }]) // target lookup

    const result = await findSimilarBeliefs(MEMORY_ID, USER)

    expect(result).toEqual([])
    expect(transactionCalled).toBe(false)
  })

  it('returns [] when the target memory does not exist', async () => {
    selectQueue.push([]) // target lookup — no row

    const result = await findSimilarBeliefs(MEMORY_ID, USER)

    expect(result).toEqual([])
    expect(transactionCalled).toBe(false)
  })

  it('runs the vector query and returns candidates when the target has an embedding', async () => {
    selectQueue.push([{ embedding: [0.1, 0.2, 0.3], dominionId: 'dom-1' }]) // target lookup
    const candidate = {
      id: 'cand-1',
      title: 'candidate belief',
      aiTitle: null,
      bodyMd: 'body',
      type: 'reflection',
      createdAt: new Date('2026-07-01'),
      confidence: 0.7,
    }
    txSelectRows = [candidate]

    const result = await findSimilarBeliefs(MEMORY_ID, USER)

    expect(transactionCalled).toBe(true)
    expect(result).toEqual([candidate])
    expect(txLimitArg).toBe(5) // default limit
  })

  it('clamps a custom limit to the documented [1,20] range', async () => {
    selectQueue.push([{ embedding: [0.1, 0.2, 0.3], dominionId: null }])
    txSelectRows = []

    await findSimilarBeliefs(MEMORY_ID, USER, { limit: 500 })

    expect(txLimitArg).toBe(20)
  })
})
