import { describe, it, expect, vi, beforeEach } from 'vitest'

// Embed on write: scheduled after the response when embeddings are on and
// the row has no vector; never blocking or failing the write.

const mocks = vi.hoisted(() => ({
  pending: [] as Array<() => unknown>,
  afterThrows: false,
  enabled: true,
  embedOne: vi.fn(async (..._a: unknown[]): Promise<number[] | null> => [0.1, 0.2]),
  returning: vi.fn(async () => [{ id: 'm1' }]),
  set: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (mocks.afterThrows) throw new Error('outside request scope')
    mocks.pending.push(fn)
  },
}))
vi.mock('@/lib/kairos/embeddings', () => ({
  embeddingsEnabled: () => mocks.enabled,
  activeEmbeddingModel: () => (mocks.enabled ? 'voyage:voyage-3.5' : null),
  embedOne: mocks.embedOne,
}))
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: (v: unknown) => {
        mocks.set(v)
        return { where: () => ({ returning: mocks.returning }) }
      },
    })),
  },
}))

import { embedMemoryNow, needsEmbedding, scheduleMemoryEmbed, type EmbeddableRow } from '../memory-embed'

const USER = 'user-1'
const ROW: EmbeddableRow = {
  id: 'm1', title: 'Morning message', summary: 'short', bodyMd: 'Keep it short.',
  streamClass: 'idea', archivedAt: null, embedding: null,
}

async function flushAfter() {
  await Promise.all(mocks.pending.splice(0).map((t) => t()))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending.length = 0
  mocks.afterThrows = false
  mocks.enabled = true
  mocks.embedOne.mockResolvedValue([0.1, 0.2])
})

describe('scheduleMemoryEmbed', () => {
  it('schedules the embed after the response and stores the document vector', async () => {
    expect(scheduleMemoryEmbed(USER, ROW)).toBe(true)
    expect(mocks.embedOne).not.toHaveBeenCalled()

    await flushAfter()

    expect(mocks.embedOne).toHaveBeenCalledWith('Morning message\n\nshort\n\nKeep it short.', 'document')
    expect(mocks.set).toHaveBeenCalledWith({ embedding: [0.1, 0.2], embeddingModel: 'voyage:voyage-3.5' })
  })

  it.each([
    ['embeddings disabled', () => { mocks.enabled = false }, ROW],
    ['row already embedded', () => {}, { ...ROW, embedding: [1, 0] }],
    ['machine meta row', () => {}, { ...ROW, streamClass: 'trace' }],
    ['archived row', () => {}, { ...ROW, archivedAt: new Date() }],
    ['no row', () => {}, null],
  ] as const)('skips when %s', (_label, setup, row) => {
    setup()
    expect(scheduleMemoryEmbed(USER, row as EmbeddableRow | null)).toBe(false)
    expect(mocks.pending).toHaveLength(0)
  })

  it('outside a request scope schedules nothing (the nightly backfill covers it)', () => {
    mocks.afterThrows = true
    expect(scheduleMemoryEmbed(USER, ROW)).toBe(false)
    expect(mocks.embedOne).not.toHaveBeenCalled()
  })

  it('an embedding failure is logged, never thrown', async () => {
    mocks.embedOne.mockRejectedValueOnce(new Error('voyage 503'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    scheduleMemoryEmbed(USER, ROW)
    await expect(flushAfter()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('embed on write failed'), expect.objectContaining({ memoryId: 'm1' }))
    expect(mocks.set).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('embedMemoryNow / needsEmbedding', () => {
  it('reports false when the provider returns no vector', async () => {
    mocks.embedOne.mockResolvedValueOnce(null)
    expect(await embedMemoryNow(USER, ROW)).toBe(false)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('reports false when a racing edit already changed the row', async () => {
    mocks.returning.mockResolvedValueOnce([])
    expect(await embedMemoryNow(USER, ROW)).toBe(false)
  })

  it('needsEmbedding mirrors the backfill eligibility', () => {
    expect(needsEmbedding(ROW)).toBe(true)
    expect(needsEmbedding({ ...ROW, streamClass: 'snapshot' })).toBe(false)
  })
})
