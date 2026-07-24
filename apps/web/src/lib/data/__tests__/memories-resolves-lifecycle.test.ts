import { describe, it, expect, vi, beforeEach } from 'vitest'

// Incident lifecycle (B) — createMemory and addLink are the two choke points
// that can introduce a 'resolves' link: createMemory backs captureMemory
// (webhooks, dispatch.ts advisory/trace writes) and any future MCP/REST
// write; addLink backs the post-hoc case of linking a NEW correction back to
// an OLD incident memory. Both funnel through the shared stampResolvedTargets
// helper and both run insert/update + stamp inside one db.transaction.
// acceptProposal is NOT covered here — it never calls createMemory/addLink
// (it UPDATEs the promoted row directly) and never writes 'resolves'-typed
// links (only 'supersedes'), so there is no double-stamp risk to guard
// against; see memories-acceptProposal.test.ts for its own (unchanged)
// supersede-stamping regression coverage.

const lastInsertValues: { value: Record<string, unknown> | null } = { value: null }
const selectQueue: unknown[][] = []
const updateSetCalls: Record<string, unknown>[] = []
const updateWhereCalls: unknown[] = []
let txUpdateReturning: unknown[] = []

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
  function makeUpdateChain(returning: unknown[]) {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      updateSetCalls.push(patch)
      return chain
    }
    chain.where = (cond: unknown) => {
      updateWhereCalls.push(cond)
      return chain
    }
    chain.returning = () => Promise.resolve(returning)
    chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain([])),
      // Both createMemory and addLink run their write + stamp inside one
      // transaction — the mock tx shares the same insert/update recorders so
      // assertions don't need to distinguish tx-scoped calls from top-level ones.
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn(() => makeInsertChain()),
          update: vi.fn(() => makeUpdateChain(txUpdateReturning)),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('../dominions', () => ({
  resolveDominionForMemory: vi.fn(async () => null),
}))

import { createMemory, addLink } from '../memories'

// Drizzle SQL/Column objects carry a `table` back-reference that makes plain
// JSON.stringify throw on circular structure — drop it so we can inspect the
// captured WHERE clause's column names / literal values as text.
function safeStringifyWhere(cond: unknown): string {
  return JSON.stringify(cond, (key, value) => (key === 'table' ? undefined : value))
}

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
  txUpdateReturning = []
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

  it('the stamp WHERE clause carries the userId and isNull(invalidAt) guards', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'resolves', target: TARGET_ID, target_kind: 'memory' }],
    })

    expect(updateWhereCalls).toHaveLength(1)
    const serialized = safeStringifyWhere(updateWhereCalls[0])
    expect(serialized).toContain('user_id')
    expect(serialized).toContain('invalid_at')
    expect(serialized).toContain(TARGET_ID)
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

  it('filters out a schema-valid but non-UUID-shaped resolves target instead of crashing', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [{ type: 'resolves', target: 'not-a-real-uuid', target_kind: 'memory' }],
    })

    expect(updateSetCalls).toHaveLength(0)
  })

  it('still stamps the valid targets when a resolves link list mixes UUID and non-UUID targets', async () => {
    await createMemory(USER, {
      ...baseInput,
      links: [
        { type: 'resolves', target: 'not-a-real-uuid', target_kind: 'memory' },
        { type: 'resolves', target: TARGET_ID, target_kind: 'memory' },
      ],
    })

    expect(updateSetCalls).toHaveLength(1)
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

describe('addLink — post-hoc resolves-link stamping', () => {
  function queueExistingMemory(links: unknown[] = []) {
    // findMemoryById (top-level db.select, outside the transaction).
    selectQueue.push([{ id: 'mem-existing', userId: USER, links }])
  }

  it('stamps invalidAt on the target when a resolves link is appended to an existing memory', async () => {
    queueExistingMemory()
    txUpdateReturning = [{ id: 'mem-existing', links: [] }]

    const result = await addLink('mem-existing', USER, {
      type: 'resolves',
      target: TARGET_ID,
      targetKind: 'memory',
    })

    expect(result?.created).toBe(true)
    // First update call is the link-append; second is the incident stamp.
    expect(updateSetCalls).toHaveLength(2)
    expect(updateSetCalls[0]).toMatchObject({ links: expect.any(Array) })
    expect(updateSetCalls[1]).toMatchObject({ invalidAt: expect.any(Date), updatedAt: expect.any(Date) })
  })

  it('does not stamp when the appended link is not a resolves/memory link', async () => {
    queueExistingMemory()
    txUpdateReturning = [{ id: 'mem-existing', links: [] }]

    await addLink('mem-existing', USER, {
      type: 'relates',
      target: TARGET_ID,
      targetKind: 'memory',
    })

    expect(updateSetCalls).toHaveLength(1)
  })

  it('filters out a non-UUID-shaped resolves target on addLink too', async () => {
    queueExistingMemory()
    txUpdateReturning = [{ id: 'mem-existing', links: [] }]

    await addLink('mem-existing', USER, {
      type: 'resolves',
      target: 'not-a-real-uuid',
      targetKind: 'memory',
    })

    expect(updateSetCalls).toHaveLength(1)
  })

  it('is a no-op when the link is a duplicate (dedup short-circuits before the transaction)', async () => {
    queueExistingMemory([{ type: 'resolves', target: TARGET_ID, target_kind: 'memory' }])

    const result = await addLink('mem-existing', USER, {
      type: 'resolves',
      target: TARGET_ID,
      targetKind: 'memory',
    })

    expect(result?.created).toBe(false)
    expect(updateSetCalls).toHaveLength(0)
  })

  it('returns null when the memory does not exist, without touching the transaction', async () => {
    selectQueue.push([]) // findMemoryById — none

    const result = await addLink('missing-mem', USER, {
      type: 'resolves',
      target: TARGET_ID,
      targetKind: 'memory',
    })

    expect(result).toBeNull()
    expect(updateSetCalls).toHaveLength(0)
  })
})
