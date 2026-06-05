import { describe, it, expect, vi, beforeEach } from 'vitest'

// Queue of arrays returned by successive db.select() chains, in the order
// retrieveContext fires them: cortex, archetypes, substrate, traces. Bundle
// goes through inspectDominion, not db.select.
const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.innerJoin = pass
    chain.leftJoin = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
    },
  }
})

vi.mock('@/lib/data/dominions', () => ({
  inspectDominion: vi.fn(),
}))

import { retrieveContext } from '../retrieve'
import { inspectDominion } from '@/lib/data/dominions'

const USER_ID = 'user-1'
const DOMINION_ID = 'b0000000-0000-4000-8000-000000000002'

const CORTEX_ID = '11111111-1111-4111-8111-111111111111'
const ARCHETYPE_ID = '22222222-2222-4222-8222-222222222222'
const SUBSTRATE_ID = '33333333-3333-4333-8333-333333333333'
const TRACE_ID = '44444444-4444-4444-8444-444444444444'

function row(id: string, streamClass: string, title: string) {
  return {
    id,
    title,
    bodyMd: `body for ${title}`,
    streamClass,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  }
}

function fakeBundle() {
  return {
    id: DOMINION_ID,
    name: 'AEON',
    vision: 'v',
    missionLong: 'm',
    objectives: [],
    projects: [],
    recentMemories: [],
    boardTasks: [],
    repos: [],
    archivedAt: null,
  } as unknown as Awaited<ReturnType<typeof inspectDominion>>
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
})

describe('retrieveContext', () => {
  it('briefer-mode (no query): returns bundle, cortex, archetypes, traces; substrate empty', async () => {
    vi.mocked(inspectDominion).mockResolvedValueOnce(fakeBundle())
    // Order matches Promise.all firing inside retrieveContext.
    selectQueue.push([row(CORTEX_ID, 'cortex', 'cortex doc')])
    selectQueue.push([row(ARCHETYPE_ID, 'archetype', 'arch 1')])
    // substrate skipped because no query — no db.select call consumes a slot.
    selectQueue.push([row(TRACE_ID, 'trace', 'last BRIEF run')])

    const r = await retrieveContext({ userId: USER_ID, dominionId: DOMINION_ID })

    expect(r.bundle).not.toBeNull()
    expect(r.bundle?.name).toBe('AEON')
    expect(r.cortex?.id).toBe(CORTEX_ID)
    expect(r.archetypes).toHaveLength(1)
    expect(r.archetypes[0].id).toBe(ARCHETYPE_ID)
    expect(r.substrate).toEqual([])
    expect(r.traces).toHaveLength(1)
    expect(r.traces[0].id).toBe(TRACE_ID)
    expect(r.traces[0].streamClass).toBe('trace')
    expect(inspectDominion).toHaveBeenCalledWith(DOMINION_ID, USER_ID, { memoryLimit: 25 })
  })

  it('chat-mode (with query): substrate populated alongside the other buckets', async () => {
    vi.mocked(inspectDominion).mockResolvedValueOnce(fakeBundle())
    selectQueue.push([row(CORTEX_ID, 'cortex', 'cortex doc')])
    selectQueue.push([row(ARCHETYPE_ID, 'archetype', 'arch 1')])
    selectQueue.push([row(SUBSTRATE_ID, 'reflection', 'reflection hit')])
    selectQueue.push([row(TRACE_ID, 'trace', 'last BRIEF run')])

    const r = await retrieveContext({
      userId: USER_ID,
      dominionId: DOMINION_ID,
      query: 'how is the project going',
    })

    expect(r.substrate).toHaveLength(1)
    expect(r.substrate[0].id).toBe(SUBSTRATE_ID)
    expect(r.substrate[0].streamClass).toBe('reflection')
    expect(r.cortex?.id).toBe(CORTEX_ID)
    expect(r.archetypes).toHaveLength(1)
    expect(r.traces).toHaveLength(1)
  })

  it('null bundle propagates when inspectDominion returns null', async () => {
    vi.mocked(inspectDominion).mockResolvedValueOnce(null)
    selectQueue.push([])
    selectQueue.push([])
    selectQueue.push([])

    const r = await retrieveContext({ userId: USER_ID, dominionId: DOMINION_ID })

    expect(r.bundle).toBeNull()
    expect(r.cortex).toBeNull()
    expect(r.archetypes).toEqual([])
    expect(r.substrate).toEqual([])
    expect(r.traces).toEqual([])
  })

  it('query shorter than 3 chars skips substrate query', async () => {
    vi.mocked(inspectDominion).mockResolvedValueOnce(fakeBundle())
    selectQueue.push([]) // cortex
    selectQueue.push([]) // archetypes
    selectQueue.push([]) // traces — substrate skipped

    const r = await retrieveContext({
      userId: USER_ID,
      dominionId: DOMINION_ID,
      query: 'hi',
    })

    expect(r.substrate).toEqual([])
  })

  it('narrows unknown streamClass values to a safe default', async () => {
    vi.mocked(inspectDominion).mockResolvedValueOnce(fakeBundle())
    selectQueue.push([row(CORTEX_ID, 'not-a-real-class', 'weird')])
    selectQueue.push([])
    selectQueue.push([])

    const r = await retrieveContext({ userId: USER_ID, dominionId: DOMINION_ID })

    expect(r.cortex?.streamClass).toBe('reflection')
  })
})
