import { beforeEach, describe, expect, it, vi } from 'vitest'

const results: unknown[] = []
const calls: Array<{ method: string; args: unknown[] }> = []
const executeResults: Array<{ rowCount: number }> = []

vi.mock('@/lib/db', () => {
  function chain(): unknown {
    const rows = results.shift() ?? []
    const proxy: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args })
          return proxy
        }
      },
    })
    return proxy
  }
  function root(method: string) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      return chain()
    }
  }
  return {
    db: {
      select: root('select'),
      selectDistinct: root('selectDistinct'),
      update: root('update'),
      execute: vi.fn(async () => executeResults.shift() ?? { rowCount: 0 }),
    },
  }
})

import { db } from '@/lib/db'
import {
  countOpenChallenges,
  listMemoryEngineUserIds,
  loadStalestEngineMemories,
  toEngineMemory,
  updateStandings,
} from '../memory-engine'

const AT = new Date('2026-10-01T01:30:00.000Z')

beforeEach(() => {
  results.length = 0
  calls.length = 0
  executeResults.length = 0
  vi.mocked(db.execute).mockClear()
})

describe('updateStandings', () => {
  it('writes nothing for an empty batch', async () => {
    expect(await updateStandings('user-1', [], AT)).toBe(0)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('writes in batches of 500 and sums row counts', async () => {
    executeResults.push({ rowCount: 500 }, { rowCount: 500 }, { rowCount: 1 })
    const updates = Array.from({ length: 1001 }, (_, i) => ({ id: `id-${i}`, standing: 0.5 }))
    expect(await updateStandings('user-1', updates, AT)).toBe(1001)
    expect(db.execute).toHaveBeenCalledTimes(3)
  })
})

describe('countOpenChallenges', () => {
  it('skips the query for no ids and maps loser counts', async () => {
    expect((await countOpenChallenges('user-1', [])).size).toBe(0)
    expect(calls).toHaveLength(0)
    results.push([{ loserId: 'a', n: 2 }, { loserId: null, n: 1 }])
    const map = await countOpenChallenges('user-1', ['a', 'b'])
    expect([...map]).toEqual([['a', 2]])
  })
})

describe('loadStalestEngineMemories', () => {
  it('returns nothing without querying for a non-positive limit', async () => {
    expect(await loadStalestEngineMemories('user-1', AT, 0)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('applies the limit', async () => {
    results.push([])
    await loadStalestEngineMemories('user-1', AT, 7, ['x'])
    expect(calls.find((c) => c.method === 'limit')?.args).toEqual([7])
  })
})

describe('listMemoryEngineUserIds', () => {
  it('returns distinct users with an active Dominion', async () => {
    results.push([{ userId: 'u1' }, { userId: 'u2' }])
    expect(await listMemoryEngineUserIds()).toEqual(['u1', 'u2'])
  })
})

describe('toEngineMemory', () => {
  it('normalises jsonb columns', () => {
    const m = toEngineMemory({
      id: 'a', userId: 'u', dominionId: null, type: 'note', streamClass: 'idea', source: 'manual',
      confidence: null, standing: null, pinned: false, createdAt: AT, validAt: AT, updatedAt: AT,
      lastUsedAt: null, useCount: 0, supersededAt: null, invalidAt: null, archivedAt: null,
      sourceMetadata: ['bad'], links: null, tags: ['x', 3],
    })
    expect(m.sourceMetadata).toEqual({})
    expect(m.links).toEqual([])
    expect(m.tags).toEqual(['x'])
  })
})
