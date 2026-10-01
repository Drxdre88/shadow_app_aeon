import { describe, it, expect, vi, beforeEach } from 'vitest'

// P2.5 — updateMemory re-attributes a row whose content an edit changes: the
// origin drops to the lower-trust of {current, writer}, prior label kept.

const selectQueue: unknown[][] = []
const setCalls: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.for = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    let patch: Record<string, unknown> = {}
    chain.set = (p: Record<string, unknown>) => {
      patch = p
      setCalls.push(p)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => Promise.resolve([{ id: 'mem-1', ...patch }])
    return chain
  }
  const select = vi.fn(() => makeSelectChain(selectQueue.shift() ?? []))
  const update = vi.fn(() => makeUpdateChain())
  return {
    db: {
      select,
      update,
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ select, update })),
    },
  }
})

import { updateMemory } from '../memories'

const USER = 'user-1'
const AGENT = { origin: { kind: 'agent' as const, via: 'mcp' } }
const OPERATOR = { origin: { kind: 'operator' as const, via: 'ui' } }

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'mem-1', userId: USER, title: 'Old', bodyMd: 'old body', summary: null, type: 'note', source: 'manual', sourceMetadata: {}, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  setCalls.length = 0
})

describe('updateMemory — origin on content edits', () => {
  it('drops an operator row to agent when an agent rewrites it, keeping priorOrigin', async () => {
    selectQueue.push([row({ sourceMetadata: { origin: { kind: 'operator', via: 'telegram' }, foo: 1 } })])

    await updateMemory('mem-1', USER, { bodyMd: 'agent text' }, AGENT)

    expect(setCalls[0].sourceMetadata).toEqual({
      foo: 1,
      origin: { kind: 'agent', via: 'mcp' },
      priorOrigin: { kind: 'operator', via: 'telegram' },
    })
  })

  it('re-attributes an unlabelled pre-P2.5 manual row (inferred operator)', async () => {
    selectQueue.push([row()])
    await updateMemory('mem-1', USER, { title: 'New', type: 'reflection' }, AGENT)
    expect(setCalls[0].sourceMetadata).toEqual({ origin: { kind: 'agent', via: 'mcp' }, priorOrigin: { kind: 'operator' } })
  })

  it('keeps an operator row operator when the operator edits it', async () => {
    selectQueue.push([row({ sourceMetadata: { origin: { kind: 'operator', via: 'ui' } } })])
    await updateMemory('mem-1', USER, { summary: 'mine' }, OPERATOR)
    expect((setCalls[0].sourceMetadata as Record<string, unknown>).origin).toEqual({ kind: 'operator', via: 'ui' })
  })

  it('never lifts a lower-trust row when the operator edits it', async () => {
    selectQueue.push([row({ source: 'webhook', sourceMetadata: { origin: { kind: 'external' } } })])
    await updateMemory('mem-1', USER, { bodyMd: 'tidied' }, OPERATOR)
    expect((setCalls[0].sourceMetadata as Record<string, unknown>).origin).toEqual({ kind: 'external', via: 'ui' })
  })

  it('treats a caller without a writer origin as an agent', async () => {
    selectQueue.push([row()])
    await updateMemory('mem-1', USER, { bodyMd: 'x' })
    expect((setCalls[0].sourceMetadata as Record<string, unknown>).origin).toEqual({ kind: 'agent', via: 'update' })
  })

  it('leaves origin alone for a non-content edit (pin / archive) without reading the row', async () => {
    const result = await updateMemory('mem-1', USER, { pinned: true, archivedAt: null }, AGENT)
    expect(result).toBeTruthy()
    expect(setCalls[0]).not.toHaveProperty('sourceMetadata')
    expect(setCalls[0]).toMatchObject({ pinned: true, archivedAt: null })
  })

  it('leaves origin alone when the content fields are resent unchanged', async () => {
    selectQueue.push([row({ sourceMetadata: { origin: { kind: 'operator' } } })])
    await updateMemory('mem-1', USER, { title: 'Old', aiTitle: 'Clean' }, AGENT)
    expect(setCalls[0]).not.toHaveProperty('sourceMetadata')
  })

  it('returns null without writing when the row is missing', async () => {
    selectQueue.push([])
    expect(await updateMemory('missing', USER, { bodyMd: 'x' }, AGENT)).toBeNull()
    expect(setCalls).toHaveLength(0)
  })
})
