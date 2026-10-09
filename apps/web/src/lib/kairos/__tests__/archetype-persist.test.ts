import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown> & { id: string }

const state = {
  live: [] as Row[],
  updates: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
}

function fakeTx() {
  return {
    execute: vi.fn(async () => undefined),
    select: () => ({ from: () => ({ where: () => ({ for: async () => state.live }) }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        state.updates.push(set)
        const where = () => {
          const result = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<unknown[]> }
          result.returning = async () => ('archivedAt' in set ? [{ id: 'archived' }] : [{ ...state.live[0], ...set }])
          return result
        }
        return { where }
      },
    }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        state.inserted.push(...rows)
        return { returning: async () => rows.map((_, i) => ({ id: `new-${i}` })) }
      },
    }),
  }
}

vi.mock('@/lib/db', () => ({ db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx())) } }))
vi.mock('@/lib/data/memory-ops', () => ({
  insertMemoryOps: vi.fn(async (_u: string, _r: string | null, ops: unknown[], _tx: unknown) => ops.length),
}))

import { insertMemoryOps } from '@/lib/data/memory-ops'
import { persistArchetypes } from '../archetype-persist'

const NOW = new Date('2026-10-09T02:10:00.000Z')
const BODY = 'Every nightly synthesis now flows through the thinking queue, answered on Max with the paid crons as fallback. The next move is retiring the paid key.'
const RUN = 'archetype:dom-1:2026-10-09'

function liveRow(id: string, title: string, overrides: Partial<Row> = {}): Row {
  return {
    id, title, summary: `${title} shapes the work.`, bodyMd: BODY, pinned: false, confidence: null,
    links: [], tags: ['kairos'], sourceMetadata: { runId: 'archetype:dom-1:2026-10-01' }, ...overrides,
  }
}

const out = (title: string, body = BODY) => ({ title, summary: `${title} shapes the work.`, body, themes: ['kairos'], citedMemoryIds: [] })

beforeEach(() => {
  vi.clearAllMocks()
  state.live = []
  state.updates = []
  state.inserted = []
})

describe('persistArchetypes (in place)', () => {
  it('keeps an unchanged archetype: same id, only a confirmedAt stamp, nothing archived or inserted', async () => {
    state.live = [liveRow('a', 'Queue first')]
    const res = await persistArchetypes('u', 'dom-1', { archetypes: [out('Queue first')], shifts: [] }, RUN, NOW)

    expect(res).toEqual({ inserted: 0, updated: 0, kept: 1, archivedPrior: 0, archetypeMemoryIds: ['a'] })
    expect(state.updates).toHaveLength(1)
    expect(Object.keys(state.updates[0])).toEqual(['sourceMetadata'])
    expect(state.inserted).toEqual([])
    expect(insertMemoryOps).not.toHaveBeenCalled()
  })

  it('updates a changed archetype in place and logs an undoable archetype_update op in the same transaction', async () => {
    state.live = [liveRow('a', 'Queue first')]
    const body = 'A different reading entirely: the board migration and auth hardening now dominate, with mobile parked until beta exit lands.'
    const res = await persistArchetypes('u', 'dom-1', { archetypes: [out('Queue first', body)], shifts: ['moved'] }, RUN, NOW)

    expect(res).toMatchObject({ updated: 1, kept: 0, inserted: 0, archetypeMemoryIds: ['a'] })
    expect(state.updates[0]).toMatchObject({ bodyMd: body, embedding: null, updatedAt: NOW })
    expect(state.updates[0].sourceMetadata).toMatchObject({ runId: RUN, confirmedAt: NOW.toISOString(), revisedAt: NOW.toISOString(), shifts: ['moved'] })
    const [, runId, ops, tx] = vi.mocked(insertMemoryOps).mock.calls[0]
    expect(runId).toBeNull()
    expect(ops).toEqual([expect.objectContaining({ memoryId: 'a', op: 'archetype_update', step: 'archetype', before: expect.objectContaining({ bodyMd: BODY }) })])
    expect(typeof (tx as { execute?: unknown }).execute).toBe('function')
  })

  it('inserts new archetypes and archives live ones the run did not return', async () => {
    state.live = [liveRow('a', 'Queue first'), liveRow('b', 'Mobile parked')]
    const res = await persistArchetypes('u', 'dom-1', { archetypes: [out('Queue first'), out('Beta auth hardening')], shifts: [] }, RUN, NOW)

    expect(res).toMatchObject({ kept: 1, inserted: 1, archivedPrior: 1, archetypeMemoryIds: ['a', 'new-0'] })
    expect(state.inserted).toEqual([expect.objectContaining({ title: 'Beta auth hardening', streamClass: 'archetype', dominionId: 'dom-1' })])
    expect(state.updates.some((u) => 'archivedAt' in u)).toBe(true)
  })

  it('archives nothing when the run returned nothing', async () => {
    state.live = [liveRow('a', 'Queue first')]
    const res = await persistArchetypes('u', 'dom-1', { archetypes: [], shifts: [] }, RUN, NOW)

    expect(res).toEqual({ inserted: 0, updated: 0, kept: 0, archivedPrior: 0, archetypeMemoryIds: [] })
    expect(state.updates).toEqual([])
  })
})
