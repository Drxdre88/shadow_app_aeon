import { describe, it, expect, vi, beforeEach } from 'vitest'

// The scan resolves a memory's own Dominion / board / repo as fk mentions
// (path-like repo values by their last segment, junk values to nothing) and
// alias hits in its text as dict mentions, never both for one entity.

const selectQueue: unknown[][] = []
const writes: Array<{ op: string; values?: unknown }> = []

vi.mock('@/lib/db', () => {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {}
    const pass = () => c
    Object.assign(c, { from: pass, innerJoin: pass, where: pass, orderBy: pass, limit: pass })
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  const tx = {
    delete: () => ({ where: async () => { writes.push({ op: 'delete' }) } }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: async () => { writes.push({ op: 'insert', values }) },
        onConflictDoUpdate: async () => { writes.push({ op: 'scan', values }) },
      }),
    }),
  }
  return {
    db: {
      select: vi.fn(() => chain(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

import { EntityScanner } from '../scan'

const ERMAC = 'e-ermac'
const DOM = 'e-dominion'
const WRAITH = 'e-wraith'

async function scanner() {
  selectQueue.push([
    { entityId: ERMAC, alias: 'stp_app_ermac', aliasNorm: 'stp_app_ermac', kind: 'repo' },
    { entityId: ERMAC, alias: 'ermac', aliasNorm: 'ermac', kind: 'repo' },
    { entityId: WRAITH, alias: 'wraith', aliasNorm: 'wraith', kind: 'repo' },
    { entityId: DOM, alias: 'Shadow Apps', aliasNorm: 'shadow apps', kind: 'dominion' },
  ])
  selectQueue.push([{ entityId: DOM, refKind: 'dominion', refId: 'dom-1' }])
  return EntityScanner.load('u1')
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  writes.length = 0
})

describe('EntityScanner', () => {
  it('resolves path-like repo values by their last segment and ignores junk', async () => {
    const s = await scanner()
    expect(s.repoEntity({ repo: 'sefe/Short Term Power/stp_app_ermac' })).toBe(ERMAC)
    expect(s.repoEntity({ repo: 'dev_26' })).toBeNull()
    expect(s.repoEntity({ repo: 'luna-high-2' })).toBeNull()
    expect(s.repoEntity({})).toBeNull()
  })

  it('writes fk mentions at 1.0 and dict mentions at 0.7, fk winning for the same entity', async () => {
    const s = await scanner()
    const done = await s.writeBatch([{
      id: 'm1', title: 'Ermac and Wraith', summary: null, bodyMd: 'Shadow Apps review',
      dominionId: 'dom-1', projectId: null, sourceMetadata: { repo: 'stp_app_ermac' },
    }])

    expect(done).toEqual({ scanned: 1, fk: 2, dict: 1 })
    expect(writes.map((w) => w.op)).toEqual(['delete', 'insert', 'insert', 'scan'])
    expect(writes[1].values).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: DOM, source: 'fk', confidence: 1 }),
      expect.objectContaining({ entityId: ERMAC, source: 'fk', confidence: 1 }),
    ]))
    expect(writes[2].values).toEqual([expect.objectContaining({ entityId: WRAITH, source: 'dict', confidence: 0.7 })])
    expect(writes[3].values).toEqual([expect.objectContaining({ memoryId: 'm1', method: 'dict' })])
  })
})
