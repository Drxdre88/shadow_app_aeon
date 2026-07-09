import { describe, it, expect, beforeEach, vi } from 'vitest'

// Galaxy graph edges — ghost-thread lineage. getGraphForUser turns a retired
// belief's supersededById soft pointer into a real DIRECTIONAL edge old→new
// ('supersedes'), so the 3D/2D galaxy can render the fading lineage thread.

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.innerJoin = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) },
  }
})

import { getGraphForUser } from '../memories'

const USER = 'user-1'

function row(
  id: string,
  opts: Partial<{ supersededAt: Date | null; supersededById: string | null }> = {},
) {
  return {
    id,
    title: `title-${id}`,
    aiTitle: null,
    type: 'note',
    source: 'manual',
    realmId: null,
    projectId: null,
    taskId: null,
    dominionId: null,
    tags: [] as string[],
    pinned: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    confidence: 0.5,
    supersededAt: opts.supersededAt ?? null,
    supersededById: opts.supersededById ?? null,
    invalidAt: null,
    links: [] as unknown[],
    sourceMetadata: {},
  }
}

// getGraphForUser fires: main rows, then Promise.all(dominions, dominionRepos,
// projects). With projectId=null on every row the projects leg is skipped, so
// exactly three db.select() calls run — main + two empty dominion lookups.
function queueGraph(rows: unknown[]) {
  selectQueue.length = 0
  selectQueue.push(rows) // main memory rows
  selectQueue.push([])   // dominions
  selectQueue.push([])   // dominion repos
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
})

describe('getGraphForUser — ghost-thread edges', () => {
  it('emits a directional supersedes edge from the retired belief to its successor', async () => {
    // a was superseded by b; both are in view.
    queueGraph([
      row('a', { supersededAt: new Date('2026-01-02'), supersededById: 'b' }),
      row('b'),
    ])
    const { edges } = await getGraphForUser(USER)
    const thread = edges.filter((e) => e.type === 'supersedes')
    expect(thread).toHaveLength(1)
    // Direction is old → new so the renderer can fade / flow toward the present.
    expect(thread[0]).toMatchObject({ source: 'a', target: 'b', type: 'supersedes' })
  })

  it('carries supersededById onto the graph node for ghost styling', async () => {
    queueGraph([
      row('a', { supersededAt: new Date('2026-01-02'), supersededById: 'b' }),
      row('b'),
    ])
    const { nodes } = await getGraphForUser(USER)
    expect(nodes.find((n) => n.id === 'a')?.supersededById).toBe('b')
    expect(nodes.find((n) => n.id === 'b')?.supersededById).toBeNull()
  })

  it('does not emit a thread when the successor is out of view', async () => {
    // Successor 'z' is not among the returned rows (archived / other realm).
    queueGraph([row('a', { supersededAt: new Date('2026-01-02'), supersededById: 'z' })])
    const { edges } = await getGraphForUser(USER)
    expect(edges.some((e) => e.type === 'supersedes')).toBe(false)
  })

  it('threads every hop of a chained supersession A→B→C', async () => {
    queueGraph([
      row('A', { supersededAt: new Date('2026-01-02'), supersededById: 'B' }),
      row('B', { supersededAt: new Date('2026-01-03'), supersededById: 'C' }),
      row('C'),
    ])
    const { edges } = await getGraphForUser(USER)
    const thread = edges
      .filter((e) => e.type === 'supersedes')
      .map((e) => `${e.source}->${e.target}`)
      .sort()
    expect(thread).toEqual(['A->B', 'B->C'])
  })
})
