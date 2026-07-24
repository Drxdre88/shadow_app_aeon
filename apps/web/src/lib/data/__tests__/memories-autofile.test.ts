import { describe, it, expect, beforeEach, vi } from 'vitest'

// createMemory slice-2 wiring — content-based Dominion auto-filing. The
// classify SQL predicates are integration-level (mirrors findSimilarBeliefs);
// what's mockable here is the decision wiring: when the embed+classify pass
// runs, what it stamps on the inserted row, and that capture never fails
// because of it. classifyDominionByContent is an exact scan (all live cortex
// rows fetched, cosine in-process) — the select queue below feeds it.

let insertedValues: Record<string, unknown> | null = null
const selectQueue: unknown[][] = []
let selectCalls = 0

function makeInsertChain() {
  return {
    values: (v: Record<string, unknown>) => {
      insertedValues = v
      return { returning: async () => [{ id: 'row-1', ...v }] }
    },
  }
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCalls++
      const rows = selectQueue.shift() ?? []
      const chain: Record<string, unknown> = {}
      const pass = () => chain
      chain.from = pass
      chain.innerJoin = pass
      chain.where = pass
      chain.limit = pass
      chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
      return chain
    }),
    insert: vi.fn(() => makeInsertChain()),
    // createMemory wraps insert + incident-lifecycle stamp in one
    // transaction; none of these fixtures pass 'resolves' links, so tx.update
    // is never actually invoked, but the tx object must still expose it.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(() => makeInsertChain()),
        update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
      }
      return fn(tx)
    }),
  },
}))

const resolveDominionForMemory = vi.fn()
vi.mock('../dominions', () => ({
  resolveDominionForMemory: (...args: unknown[]) => resolveDominionForMemory(...args),
}))

const embedOne = vi.fn()
vi.mock('@/lib/kairos/embeddings', () => ({
  embedOne: (...args: unknown[]) => embedOne(...args),
  embedTexts: vi.fn(),
  embeddingsEnabled: vi.fn(() => true),
  activeEmbeddingModel: vi.fn(() => 'voyage:voyage-3.5'),
  toVectorLiteral: (vec: number[]) => `[${vec.join(',')}]`,
}))

import { createMemory, classifyDominionByContent } from '../memories'

const USER = 'user-1'
// Probe aligned with dom-b's cortex, orthogonal to dom-a's — exact cosine.
const VEC = [1, 0, 0]

const baseInput = {
  title: 'Standalone thought',
  bodyMd: 'A note with no structural home.',
  type: 'note',
  source: 'manual',
} as Parameters<typeof createMemory>[1]

beforeEach(() => {
  vi.clearAllMocks()
  insertedValues = null
  selectQueue.length = 0
  selectCalls = 0
  resolveDominionForMemory.mockResolvedValue(null)
  embedOne.mockResolvedValue(VEC)
  delete process.env.KAIROS_AUTO_FILE_MIN_SIM
})

describe('createMemory auto-filing', () => {
  it('skips embed+classify entirely when an explicit dominionId is given', async () => {
    await createMemory(USER, { ...baseInput, dominionId: 'dom-explicit' })

    expect(embedOne).not.toHaveBeenCalled()
    expect(selectCalls).toBe(0)
    expect(insertedValues?.dominionId).toBe('dom-explicit')
  })

  it('skips embed+classify when structural resolution finds a Dominion', async () => {
    resolveDominionForMemory.mockResolvedValue('dom-structural')

    await createMemory(USER, baseInput)

    expect(embedOne).not.toHaveBeenCalled()
    expect(insertedValues?.dominionId).toBe('dom-structural')
  })

  it('skips embed+classify for ineligible machine streams (aether stays global)', async () => {
    await createMemory(USER, { ...baseInput, streamClass: 'aether' })

    expect(embedOne).not.toHaveBeenCalled()
    expect(insertedValues?.dominionId).toBeNull()
  })

  it('files to the nearest Dominion above threshold: FK + soft tag + provenance + stored vector', async () => {
    selectQueue.push([{ dominionId: 'dom-c', embedding: [1, 0, 0] }]) // similarity 1

    await createMemory(USER, { ...baseInput, tags: ['existing'] })

    expect(insertedValues?.dominionId).toBe('dom-c')
    expect(insertedValues?.tags).toEqual(['existing', 'dominion:dom-c'])
    expect(insertedValues?.sourceMetadata).toMatchObject({ kairosAutoFiled: { similarity: 1 } })
    expect(insertedValues?.embedding).toEqual(VEC)
    expect(insertedValues?.embeddingModel).toBe('voyage:voyage-3.5')
  })

  it('leaves the memory unfiled below threshold but still stores the vector', async () => {
    selectQueue.push([{ dominionId: 'dom-c', embedding: [0, 1, 0] }]) // similarity 0

    await createMemory(USER, baseInput)

    expect(insertedValues?.dominionId).toBeNull()
    expect(insertedValues?.tags).toEqual([])
    expect(insertedValues?.sourceMetadata).toEqual({})
    expect(insertedValues?.embedding).toEqual(VEC)
  })

  it('leaves the memory unfiled when no Dominion has an embedded cortex yet', async () => {
    selectQueue.push([])

    await createMemory(USER, baseInput)

    expect(insertedValues?.dominionId).toBeNull()
    expect(insertedValues?.embedding).toEqual(VEC)
  })

  it('degrades to unfiled with no stored vector when embeddings are disabled', async () => {
    embedOne.mockResolvedValue(null)

    await createMemory(USER, baseInput)

    expect(selectCalls).toBe(0)
    expect(insertedValues?.dominionId).toBeNull()
    expect(insertedValues).not.toHaveProperty('embedding')
  })

  it('never fails capture when embed/classify throws', async () => {
    embedOne.mockRejectedValue(new Error('voyage down'))

    const row = await createMemory(USER, baseInput)

    expect(row).toBeTruthy()
    expect(insertedValues?.dominionId).toBeNull()
    expect(insertedValues).not.toHaveProperty('embedding')
  })

  it('does not duplicate an already-present dominion tag', async () => {
    selectQueue.push([{ dominionId: 'dom-c', embedding: [1, 0, 0] }])

    await createMemory(USER, { ...baseInput, tags: ['dominion:dom-c'] })

    expect(insertedValues?.tags).toEqual(['dominion:dom-c'])
  })
})

describe('classifyDominionByContent', () => {
  it('picks the nearest Dominion across all live cortex rows (exact scan)', async () => {
    selectQueue.push([
      { dominionId: 'dom-a', embedding: [0, 1, 0] }, // similarity 0
      { dominionId: 'dom-b', embedding: [1, 0, 0] }, // similarity 1
      { dominionId: 'dom-d', embedding: [0.5, 0.5, 0] }, // similarity ~0.707
    ])

    const match = await classifyDominionByContent(USER, VEC)

    expect(match?.dominionId).toBe('dom-b')
    expect(match?.similarity).toBeCloseTo(1)
  })

  it('skips rows with a malformed embedding instead of crashing', async () => {
    selectQueue.push([
      { dominionId: 'dom-a', embedding: null },
      { dominionId: 'dom-b', embedding: [1, 0, 0] },
    ])

    const match = await classifyDominionByContent(USER, VEC)

    expect(match?.dominionId).toBe('dom-b')
  })

  it('returns null when no cortex row qualifies', async () => {
    selectQueue.push([])

    expect(await classifyDominionByContent(USER, VEC)).toBeNull()
  })
})
