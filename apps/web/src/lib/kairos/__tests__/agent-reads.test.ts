import { describe, it, expect, vi, beforeEach } from 'vitest'

// Agent reads count as use: capped, deduped, scheduled after the response,
// and never able to fail the read.

const mocks = vi.hoisted(() => ({
  reactUsed: vi.fn(async (..._a: unknown[]) => undefined),
  pending: [] as Array<() => unknown>,
  afterThrows: false,
}))

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (mocks.afterThrows) throw new Error('outside request scope')
    mocks.pending.push(fn)
  },
}))
vi.mock('../reactions', () => ({ reactUsed: mocks.reactUsed }))

import { AGENT_READ_CAP, noteAgentReads, relevantSourceIds } from '../agent-reads'

const USER = 'user-1'
const ids = Array.from({ length: 8 }, (_, i) => `a000000${i}-0000-4000-8000-000000000000`)

async function flushAfter() {
  await Promise.all(mocks.pending.splice(0).map((t) => t()))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending.length = 0
  mocks.afterThrows = false
})

describe('noteAgentReads', () => {
  it('defers reactUsed to after() with the top hits and an agent-read reason', async () => {
    expect(noteAgentReads(USER, [ids[0], ids[0], ...ids.slice(1)], 'mcp:search_memories')).toBe(true)
    expect(mocks.reactUsed).not.toHaveBeenCalled()

    await flushAfter()

    expect(mocks.reactUsed).toHaveBeenCalledWith(USER, ids.slice(0, AGENT_READ_CAP), 'agent-read:mcp:search_memories')
  })

  it('does nothing for an empty hit list', () => {
    expect(noteAgentReads(USER, [], 'rest:search_memories')).toBe(false)
    expect(mocks.pending).toHaveLength(0)
  })

  it('a failing reaction never surfaces to the caller', async () => {
    mocks.reactUsed.mockRejectedValueOnce(new Error('db down'))
    noteAgentReads(USER, ids, 'rest:prepare_context')

    await expect(flushAfter()).resolves.toBeUndefined()
  })

  it('outside a request scope it still runs, fire-and-forget', async () => {
    mocks.afterThrows = true

    expect(noteAgentReads(USER, ids.slice(0, 2), 'mcp:prepare_context')).toBe(true)
    await Promise.resolve()

    expect(mocks.reactUsed).toHaveBeenCalledWith(USER, ids.slice(0, 2), 'agent-read:mcp:prepare_context')
  })
})

describe('relevantSourceIds', () => {
  it('keeps only the "Most relevant" section (pinned rows are not a relevance signal)', () => {
    expect(relevantSourceIds([
      { id: 'p', section: 'pinned' },
      { id: 'r1', section: 'relevant' },
      { id: 'x', section: 'related' },
      { id: 'r2', section: 'relevant' },
    ])).toEqual(['r1', 'r2'])
  })
})
