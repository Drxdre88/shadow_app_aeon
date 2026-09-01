import { describe, it, expect, vi, beforeEach } from 'vitest'

// Kairos Phase 3C — pin the streamClass override invariant in createMemory.
// The dispatcher relies on this to write 'advisory' primaries and 'trace'
// bookkeeping rows. If Drizzle ever stopped honouring the conditional spread
// (e.g. an "always include streamClass" refactor), every advisory and trace
// would silently land as the DB default 'idea' and Cartographer / Oracle
// scans would break.

const lastInsertValues: { value: Record<string, unknown> | null } = { value: null }
const selectQueue: unknown[][] = []

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
  return {
    db: {
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => makeInsertChain()),
      // createMemory wraps insert + incident-lifecycle stamp in one
      // transaction; none of these fixtures pass 'resolves' links, so
      // tx.update is never actually invoked, but tx must still expose it.
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn(() => makeInsertChain()),
          update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('../dominions', () => ({
  resolveDominionForMemory: vi.fn(async () => null),
}))

import { createMemory, captureMemory } from '../memories'

const USER = 'user-1'
const DOMINION = 'b0000000-0000-4000-8000-000000000002'

const baseInput = {
  title: 'test',
  bodyMd: 'body',
  type: 'advisory' as const,
  source: 'cron' as const,
  dominionId: DOMINION,
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  lastInsertValues.value = null
})

describe('createMemory — streamClass override', () => {
  it('forwards streamClass to db.insert when set', async () => {
    await createMemory(USER, { ...baseInput, streamClass: 'advisory' })
    expect(lastInsertValues.value).toBeTruthy()
    expect(lastInsertValues.value).toHaveProperty('streamClass', 'advisory')
  })

  it('forwards streamClass=trace for dispatcher bookkeeping writes', async () => {
    await createMemory(USER, {
      ...baseInput,
      type: 'session_event',
      source: 'system',
      streamClass: 'trace',
    })
    expect(lastInsertValues.value).toHaveProperty('streamClass', 'trace')
  })

  it('omits streamClass from db.insert when not set (DB default kicks in)', async () => {
    await createMemory(USER, baseInput)
    expect(lastInsertValues.value).toBeTruthy()
    expect(lastInsertValues.value).not.toHaveProperty('streamClass')
  })
})

describe('createMemory — coding-agent session idempotency', () => {
  it.each([
    ['codex', { sessionId: 'codex-session-1', client: 'codex' }],
    ['copilot', { sessionId: 'copilot-session-1', client: 'copilot' }],
    ['hook', { sessionId: 'copilot-session-1', client: 'copilot', originalSource: 'copilot' }],
  ] as const)('returns an existing %s session instead of inserting a duplicate', async (source, sourceMetadata) => {
    const existing = { id: 'existing-memory' }
    selectQueue.push([existing])

    const result = await createMemory(USER, {
      ...baseInput,
      type: 'session_summary',
      source,
      sourceMetadata,
    })

    expect(result).toBe(existing)
    expect(lastInsertValues.value).toBeNull()
  })
})

describe('captureMemory — streamClass override', () => {
  it('forwards streamClass through to the underlying createMemory insert', async () => {
    // No externalId → no dedup lookup. Skip the sessionId path (source != claude).
    selectQueue.push([]) // sessionId early-out check returns nothing
    await captureMemory(USER, { ...baseInput, streamClass: 'advisory' })
    expect(lastInsertValues.value).toHaveProperty('streamClass', 'advisory')
  })

  it('omits streamClass when caller does not pass it', async () => {
    selectQueue.push([])
    await captureMemory(USER, baseInput)
    expect(lastInsertValues.value).not.toHaveProperty('streamClass')
  })
})
