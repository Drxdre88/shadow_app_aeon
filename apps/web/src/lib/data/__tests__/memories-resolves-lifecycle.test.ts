import { describe, it, expect, vi, beforeEach } from 'vitest'

// Incident lifecycle (B) — createMemory is the single choke point: a newly
// inserted memory carrying a 'resolves' link stamps each same-user target's
// invalidAt. This covers captureMemory (webhooks, dispatch.ts advisory/trace
// writes) and any future MCP/REST write, since they all funnel through
// createMemory. acceptProposal is NOT covered here — it never calls
// createMemory (it UPDATEs the promoted row directly) and never writes
// 'resolves'-typed links (only 'supersedes'), so there is no double-stamp
// risk to guard against; see memories-acceptProposal.test.ts for its own
// (unchanged) supersede-stamping regression coverage.

const lastInsertValues: { value: Record<string, unknown> | null } = { value: null }
const selectQueue: unknown[][] = []
const updateSetCalls: Record<string, unknown>[] = []
const updateWhereCalls: unknown[] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function makeInsertChain() {
    const chain: Record<string, unknown> = {}
    chain.values = (v: Record<string, unknown>) => {
      lastInsertValues.value = v
      return chain
    }
    chain.returning = () => Promise.resolve([{ id: 'mem-1', ...lastInsertValues.value }])
    return chain
  }
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      updateSetCalls.push(patch)
      return chain
    }
    chain.where = (cond: unknown) => {
      updateWhereCalls.push(cond)
      return chain
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain()),
    },
  }
})

vi.mock('../dominions', () => ({
  resolveDominionForMemory: vi.fn(async () => null),
}))

import { createMemory } from '../memories'

const USER = 'user-1'
const DOMINION = 'b0000000-0000-4000-8000-000000000002'
const TARGET_ID = 'c0000000-0000-4000-8000-000000000003'

const baseInput = {
  title: 'Incident closed',
  bodyMd: 'body',
  type: 'observation' as const,
  source: 'cron' as const,
  dominionId: DOMINION,
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  lastInsertValues.value = null
  updateSetCalls.length = 0
  updateWhereCalls.length = 0
})

describe('createMemory — resolves-link lifecycle stamping', () => {
  it('stamps invalidAt on the target when a resolves link is present', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'resolves', target: TARGET_ID, target_kind: 'memory' }],
    })

    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0]).toMatchObject({ invalidAt: expect.any(Date), updatedAt: expect.any(Date) })
    expect(updateWhereCalls).toHaveLength(1)
  })

  it('batches multiple resolves targets into a single update call', async () => {
    const OTHER_TARGET = 'd0000000-0000-4000-8000-000000000004'
    await createMemory(USER, {
      ...baseInput,
      links: [
        { type: 'resolves', target: TARGET_ID, target_kind: 'memory' },
        { type: 'resolves', target: OTHER_TARGET, target_kind: 'memory' },
      ],
    })

    expect(updateSetCalls).toHaveLength(1)
  })

  it('does not stamp anything when there are no resolves links', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'refers_to', target: TARGET_ID, target_kind: 'memory' }],
    })

    expect(updateSetCalls).toHaveLength(0)
  })

  it('does not stamp when links are omitted entirely', async () => {
    await createMemory(USER, baseInput)
    expect(updateSetCalls).toHaveLength(0)
  })

  it('ignores non-memory-kind resolves links (e.g. task/url targets)', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'resolves', target: 'https://example.com/incident/1', target_kind: 'url' }],
    })

    expect(updateSetCalls).toHaveLength(0)
  })

  it('still returns the created memory row when a resolves link is present', async () => {
    const memory = await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'resolves', target: TARGET_ID, target_kind: 'memory' }],
    })

    expect(memory.id).toBe('mem-1')
    expect(memory.title).toBe('Incident closed')
  })
})
