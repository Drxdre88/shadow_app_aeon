import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Belief ledger writes: one transaction per batch, every memory write and its
// memory_ops row on the SAME tx handle, idempotent by key. No real DB.

type Via = 'db' | 'tx'
interface Call { via: Via; kind: 'execute' | 'select' | 'insert' | 'update'; arg?: unknown; where?: unknown; orderBy?: unknown[] }

const state = vi.hoisted(() => ({
  calls: [] as Array<{ via: 'db' | 'tx'; kind: string; arg?: unknown; where?: unknown; orderBy?: unknown[] }>,
  selectQueue: [] as unknown[][],
  insertQueue: [] as unknown[][],
  txHandles: [] as unknown[],
}))

vi.mock('@/lib/db', () => {
  function handle(via: 'db' | 'tx') {
    return {
      execute: async (arg: unknown) => { state.calls.push({ via, kind: 'execute', arg }) },
      select: () => {
        const call: { via: 'db' | 'tx'; kind: string; where?: unknown; orderBy?: unknown[] } = { via, kind: 'select' }
        state.calls.push(call)
        const chain: Record<string, unknown> = {}
        for (const m of ['from', 'limit', 'for', 'innerJoin', 'leftJoin']) chain[m] = () => chain
        chain.orderBy = (...args: unknown[]) => {
          call.orderBy = args
          return chain
        }
        chain.where = (w: unknown) => {
          call.where = w
          return chain
        }
        chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(state.selectQueue.shift() ?? []).then(res, rej)
        return chain
      },
      insert: () => ({
        values: (arg: unknown) => {
          state.calls.push({ via, kind: 'insert', arg })
          return { returning: async () => state.insertQueue.shift() ?? [] }
        },
      }),
      update: () => ({
        set: (arg: unknown) => {
          state.calls.push({ via, kind: 'update', arg })
          return { where: async () => undefined }
        },
      }),
    }
  }
  const db = {
    ...handle('db'),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = handle('tx')
      state.txHandles.push(tx)
      return fn(tx)
    }),
  }
  return { db }
})

vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`true` }
})
vi.mock('@/lib/data/memory-ops', () => ({
  insertMemoryOps: vi.fn(async (_u: string, _r: string | null, ops: unknown[]) => ops.length),
}))

import { db } from '@/lib/db'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { beliefRowValues, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import { listOperatorSignals, listUnmirroredPromotions, retireOwnBelief, writeAlignedBeliefs, writeOwnMirror } from '../beliefs'
import { listFlaggedAlignedBeliefs, mutateHeldBelief } from '../belief-recheck'

const USER = 'user-1'
const JOB = '99999999-0000-4000-8000-000000000009'
const KEY = 'belief_extract:2026-10-01'
const OLD = 'aaaaaaaa-0000-4000-8000-00000000000a'
const NEW = 'bbbbbbbb-0000-4000-8000-00000000000b'
const REINF = 'cccccccc-0000-4000-8000-00000000000c'
const NOW = new Date('2026-10-01T03:00:00Z')
const dialect = new PgDialect()

function belief(over: Partial<BeliefV1> = {}): BeliefV1 {
  return {
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'Quality first', reasons: [],
    falsifier: 'x', sourceType: 'operator', provenance: ['m-1'], status: 'held', confidence: 0.7, ...over,
  }
}

const calls = () => state.calls as Call[]

beforeEach(() => {
  vi.clearAllMocks()
  state.calls.length = 0
  state.selectQueue.length = 0
  state.insertQueue.length = 0
  state.txHandles.length = 0
})

describe('writeAlignedBeliefs', () => {
  function queueHappyPath() {
    state.selectQueue.push(
      [], // no prior ops for this extractKey
      [{ id: OLD, sourceMetadata: { kind: 'belief', belief: belief({ claim: 'Speed first' }) }, links: [] }],
      [{ id: REINF, sourceMetadata: { kind: 'belief', belief: belief({ provenance: ['m-0'] }) }, links: [{ type: 'refers_to', target: 'm-0', target_kind: 'memory' }] }],
      [{ id: 'm-0', source: 'manual', sourceMetadata: {} }, { id: 'm-1', source: 'manual', sourceMetadata: {} }], // union provenance origins
    )
    state.insertQueue.push([{ id: NEW }])
  }

  const writes = () => ({
    create: [{ values: beliefRowValues(belief({ supersedes: OLD })), supersedes: OLD, reason: 'replace' }],
    reinforce: [{ targetId: REINF, provenance: ['m-1'], reason: 'restated' }],
  })

  it('inserts, supersedes, reinforces and logs ops inside ONE transaction on the tx handle', async () => {
    queueHappyPath()
    const res = await writeAlignedBeliefs(USER, JOB, KEY, writes(), NOW)

    expect(res).toEqual({ written: true, created: [NEW], superseded: [OLD], reinforced: [REINF], retired: [], refusedReplaces: [] })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(calls().every((c) => c.via === 'tx')).toBe(true)
    expect(calls()[0].kind).toBe('execute') // advisory lock first

    const updates = calls().filter((c) => c.kind === 'update').map((c) => c.arg as Record<string, unknown>)
    expect(updates[0]).toMatchObject({ supersededAt: NOW, supersededById: NEW, invalidAt: NOW })
    expect((updates[0].sourceMetadata as { belief: BeliefV1 }).belief.status).toBe('retired')
    expect((updates[1].sourceMetadata as { belief: BeliefV1 }).belief.provenance).toEqual(['m-0', 'm-1'])
    expect((updates[1].links as unknown[]).length).toBe(2)

    expect(insertMemoryOps).toHaveBeenCalledTimes(1)
    const [uid, runId, ops, tx] = vi.mocked(insertMemoryOps).mock.calls[0]
    expect([uid, runId]).toEqual([USER, JOB])
    expect(tx).toBe(state.txHandles[0])
    expect(ops).toEqual([
      expect.objectContaining({ memoryId: NEW, step: 'beliefs', op: 'promote', before: null, after: { beliefId: NEW, mind: 'aligned', extractKey: KEY, sourceType: 'operator', supersedes: OLD } }),
      expect.objectContaining({
        memoryId: REINF, step: 'beliefs', op: 'feedback',
        before: expect.objectContaining({ belief: { provenance: ['m-0'], sourceType: 'operator', confidence: 0.7, recheck: null } }),
      }),
    ])
  })

  it('propagates an op-insert failure so the whole batch rolls back', async () => {
    queueHappyPath()
    vi.mocked(insertMemoryOps).mockRejectedValueOnce(new Error('op insert failed'))
    await expect(writeAlignedBeliefs(USER, JOB, KEY, writes(), NOW)).rejects.toThrow('op insert failed')
  })

  it('is a no-op when this extractKey already logged ops (double submit)', async () => {
    state.selectQueue.push([{ memoryId: NEW }])
    const res = await writeAlignedBeliefs(USER, JOB, KEY, writes(), NOW)
    expect(res).toEqual({ written: false, created: [NEW], superseded: [], reinforced: [], retired: [], refusedReplaces: [] })
    expect(calls().some((c) => c.kind === 'insert' || c.kind === 'update')).toBe(false)
    expect(insertMemoryOps).not.toHaveBeenCalled()
  })

  it('lands a replace as a plain new belief when its target is no longer held', async () => {
    state.selectQueue.push([], []) // no prior ops; target not lockable
    state.insertQueue.push([{ id: NEW }])
    const res = await writeAlignedBeliefs(USER, JOB, KEY, { create: writes().create, reinforce: [] }, NOW)
    expect(res.superseded).toEqual([])
    const inserted = calls().find((c) => c.kind === 'insert')!.arg as { sourceMetadata: { belief: BeliefV1 } }
    expect(inserted.sourceMetadata.belief.supersedes).toBeUndefined()
    expect(calls().some((c) => c.kind === 'update')).toBe(false)
    const ops = vi.mocked(insertMemoryOps).mock.calls[0][2]
    expect(ops[0].after).toEqual({ beliefId: NEW, mind: 'aligned', extractKey: KEY, sourceType: 'operator' })
  })

  it('refuses an inference-only replace of an operator belief: lands as a new held belief and logs why', async () => {
    state.selectQueue.push([], [{ id: OLD, sourceMetadata: { belief: belief() }, links: [], invalidAt: null }])
    state.insertQueue.push([{ id: NEW }])
    const values = beliefRowValues(belief({ sourceType: 'inference', confidence: 0.6, supersedes: OLD }))
    const res = await writeAlignedBeliefs(USER, JOB, KEY, { create: [{ values, supersedes: OLD, reason: 'chat summary' }], reinforce: [] }, NOW)
    expect(res).toMatchObject({ created: [NEW], superseded: [], refusedReplaces: [OLD] })
    expect(calls().some((c) => c.kind === 'update')).toBe(false)
    const inserted = calls().find((c) => c.kind === 'insert')!.arg as { sourceMetadata: { belief: BeliefV1 } }
    expect(inserted.sourceMetadata.belief.supersedes).toBeUndefined()
    const [op] = vi.mocked(insertMemoryOps).mock.calls[0][2]
    expect(op.after).toMatchObject({ replaceRefused: OLD, sourceType: 'inference' })
    expect(op.reason).toMatch(/inference-only evidence may not replace/)
  })

  it('lets an inference-sourced create replace an inference-sourced belief', async () => {
    state.selectQueue.push([], [{ id: OLD, sourceMetadata: { belief: belief({ sourceType: 'inference' }) }, links: [], invalidAt: null }])
    state.insertQueue.push([{ id: NEW }])
    const values = beliefRowValues(belief({ sourceType: 'inference', confidence: 0.6, supersedes: OLD }))
    const res = await writeAlignedBeliefs(USER, JOB, KEY, { create: [{ values, supersedes: OLD, reason: 'r' }], reinforce: [] }, NOW)
    expect(res).toMatchObject({ superseded: [OLD], refusedReplaces: [] })
  })

  it('an operator-origin reinforcement upgrades an inference belief, caps confidence, and a reaffirm clears the flag', async () => {
    const flagged = belief({
      sourceType: 'inference', confidence: 0.42, provenance: ['k-1', 'gone'],
      recheck: { since: '2026-09-29T02:00:00.000Z', lostSources: [{ id: 'gone', state: 'missing' }] },
    })
    state.selectQueue.push(
      [],
      [{ id: REINF, sourceMetadata: { belief: flagged }, links: [], invalidAt: null }],
      [{ id: 'k-1', source: 'cron', sourceMetadata: {} }, { id: 'op-1', source: 'manual', sourceMetadata: {} }],
    )
    const res = await writeAlignedBeliefs(USER, JOB, KEY, { create: [], reinforce: [{ targetId: REINF, provenance: ['op-1'], confidence: 0.99, reason: 'said again' }] }, NOW)
    expect(res.reinforced).toEqual([REINF])
    const update = calls().find((c) => c.kind === 'update')!.arg as { sourceMetadata: { belief: BeliefV1 } }
    expect(update.sourceMetadata.belief).toMatchObject({ sourceType: 'operator', confidence: 0.95, provenance: ['k-1', 'op-1'] })
    expect(update.sourceMetadata.belief.recheck).toBeUndefined()
    const [op] = vi.mocked(insertMemoryOps).mock.calls[0][2]
    expect(op).toMatchObject({ op: 'feedback', after: { reaffirmed: true } })
    expect((op.before as { belief: { recheck: unknown } }).belief.recheck).toEqual(flagged.recheck)
  })

  it('a reinforcement whose union evidence is only Kairos-derived stays inference and within its cap', async () => {
    state.selectQueue.push(
      [],
      [{ id: REINF, sourceMetadata: { belief: belief({ sourceType: 'inference', confidence: 0.5, provenance: ['k-1'] }) }, links: [], invalidAt: null }],
      [{ id: 'k-1', source: 'cron', sourceMetadata: {} }, { id: 'k-2', source: 'cron', sourceMetadata: {} }],
    )
    await writeAlignedBeliefs(USER, JOB, KEY, { create: [], reinforce: [{ targetId: REINF, provenance: ['k-2'], confidence: 0.9, reason: 'r' }] }, NOW)
    const update = calls().find((c) => c.kind === 'update')!.arg as { sourceMetadata: { belief: BeliefV1 } }
    expect(update.sourceMetadata.belief).toMatchObject({ sourceType: 'inference', confidence: 0.6 })
  })

  it('retires only a flagged held belief, with a revertable retire op', async () => {
    const flagged = belief({ recheck: { since: '2026-09-29T02:00:00.000Z', lostSources: [{ id: 'm-1', state: 'archived' }] } })
    state.selectQueue.push(
      [],
      [{ id: OLD, sourceMetadata: { belief: flagged }, links: [], invalidAt: null }],
      [{ id: REINF, sourceMetadata: { belief: belief() }, links: [], invalidAt: null }], // not flagged
    )
    const res = await writeAlignedBeliefs(USER, JOB, KEY, {
      create: [], reinforce: [],
      retire: [{ targetId: OLD, reason: 'no longer true' }, { targetId: REINF, reason: 'sneaky' }],
    }, NOW)
    expect(res.retired).toEqual([OLD])
    const updates = calls().filter((c) => c.kind === 'update').map((c) => c.arg as Record<string, unknown>)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ invalidAt: NOW, supersededAt: null })
    expect((updates[0].sourceMetadata as { belief: BeliefV1 }).belief.status).toBe('retired')
    const ops = vi.mocked(insertMemoryOps).mock.calls[0][2]
    expect(ops).toEqual([expect.objectContaining({
      memoryId: OLD, op: 'retire',
      before: { invalidAt: null, supersededAt: null, belief: { status: 'held' } },
      after: expect.objectContaining({ invalidAt: NOW.toISOString(), belief: { status: 'retired' }, extractKey: KEY }),
    })])
  })
})

describe('writeOwnMirror', () => {
  const values = () => beliefRowValues(belief({ mind: 'own', sourceType: 'inference' }))
  const meta = { proposalId: 'prop-1', sourceOpId: 'op-1', reason: 'mirror' }

  it('writes the own belief keyed by mirroredFrom plus its op in one transaction', async () => {
    state.selectQueue.push([])
    state.insertQueue.push([{ id: NEW }])
    expect(await writeOwnMirror(USER, values(), meta)).toEqual({ memoryId: NEW, written: true })
    const inserted = calls().find((c) => c.kind === 'insert')!.arg as { sourceMetadata: Record<string, unknown>; streamClass: string }
    expect(inserted.sourceMetadata).toMatchObject({ mirroredFrom: 'prop-1', mirroredFromOpId: 'op-1' })
    expect(inserted.streamClass).toBe('belief')
    expect(calls().every((c) => c.via === 'tx')).toBe(true)
    expect(vi.mocked(insertMemoryOps).mock.calls[0][3]).toBe(state.txHandles[0])
  })

  it('is idempotent: an existing mirror is returned unwritten', async () => {
    state.selectQueue.push([{ id: OLD }])
    expect(await writeOwnMirror(USER, values(), meta)).toEqual({ memoryId: OLD, written: false })
    expect(calls().some((c) => c.kind === 'insert')).toBe(false)
    expect(insertMemoryOps).not.toHaveBeenCalled()
  })

  it('tags its op with the engine run id', async () => {
    state.selectQueue.push([])
    state.insertQueue.push([{ id: NEW }])
    await writeOwnMirror(USER, values(), { ...meta, runId: 'run-7' })
    expect(vi.mocked(insertMemoryOps).mock.calls[0][1]).toBe('run-7')
  })
})

describe('retireOwnBelief', () => {
  it('retires a held own belief and tags its op with the run id', async () => {
    state.selectQueue.push([{ id: OLD, sourceMetadata: { belief: belief({ mind: 'own', sourceType: 'inference' }) }, links: [] }])
    expect(await retireOwnBelief(USER, OLD, 'reverted', NOW, 'run-7')).toBe(true)
    const [, runId, ops, tx] = vi.mocked(insertMemoryOps).mock.calls[0]
    expect(runId).toBe('run-7')
    expect(tx).toBe(state.txHandles[0])
    expect(ops[0]).toMatchObject({ memoryId: OLD, op: 'decay' })
  })
})

describe('listOperatorSignals', () => {
  const row = (id: string, source: string, sourceMetadata: Record<string, unknown> = {}) => ({
    id, title: 't', aiTitle: null, summary: null, bodyMd: 'b', type: 'reflection', kind: null, createdAt: NOW, source, sourceMetadata,
  })

  it('labels each row by origin and drops external-origin rows (SQL and JS)', async () => {
    state.selectQueue.push([
      row('a', 'manual'),
      row('b', 'cron'),
      row('c', 'webhook'),
      row('d', 'manual', { origin: { kind: 'external', via: 'import' } }),
      row('e', 'claude'),
    ])
    const out = await listOperatorSignals(USER, null)
    expect(out.map((r) => [r.id, r.origin])).toEqual([['a', 'operator'], ['b', 'kairos'], ['e', 'agent']])
    expect(out[0]).not.toHaveProperty('sourceMetadata')
    expect(dialect.sqlToQuery(calls()[0].where as SQL).sql).toContain("<> 'external'")
  })

  it('reads oldest first so a backlog drains across nights', async () => {
    state.selectQueue.push([])
    await listOperatorSignals(USER, NOW)
    const [first] = calls()[0].orderBy as SQL[]
    expect(dialect.sqlToQuery(first).sql).toMatch(/"created_at" asc/)
  })
})

describe('listUnmirroredPromotions', () => {
  it('reads only live BackUp promotions without an existing mirror', async () => {
    state.selectQueue.push([])
    await listUnmirroredPromotions(USER, NOW)
    const q = dialect.sqlToQuery(calls()[0].where as SQL)
    expect(q.params).toEqual(expect.arrayContaining(['promote', 'backup', USER]))
    expect(q.sql).toContain('NOT EXISTS')
    expect(q.sql).toContain("'mirroredFrom'")
    expect(q.sql).toContain('"reverted_at" is null')
  })
})

describe('mutateHeldBelief (re-check writes)', () => {
  it('writes the row and its ops on the SAME tx, tagged with the run id', async () => {
    state.selectQueue.push([{ id: OLD, sourceMetadata: { belief: belief() }, links: [], invalidAt: null }])
    const ops = await mutateHeldBelief(USER, OLD, (row) => ({
      sourceMetadata: { ...row.sourceMetadata, belief: { ...belief(), confidence: 0.56 } },
      ops: [{ step: 'recheck', op: 'recheck', before: { belief: { confidence: 0.7 } }, after: { belief: { confidence: 0.56 } }, reason: 'lost' }],
    }), 'run-7', NOW)
    expect(ops).toEqual([expect.objectContaining({ memoryId: OLD, op: 'recheck' })])
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(calls().every((c) => c.via === 'tx')).toBe(true)
    expect(calls().find((c) => c.kind === 'update')!.arg).toMatchObject({ updatedAt: NOW })
    const [, runId, , tx] = vi.mocked(insertMemoryOps).mock.calls[0]
    expect(runId).toBe('run-7')
    expect(tx).toBe(state.txHandles[0])
  })

  it('withOrigins reads the provenance origins on the same tx and hands them to decide', async () => {
    state.selectQueue.push(
      [{ id: OLD, sourceMetadata: { belief: belief({ provenance: ['m-1'] }) }, links: [], invalidAt: null }],
      [{ id: 'm-1', source: 'cron', sourceMetadata: {} }],
    )
    let seen: ReadonlyMap<string, string> | null = null
    await mutateHeldBelief(USER, OLD, (_row, origins) => { seen = origins; return null }, null, NOW, { withOrigins: true })
    expect(seen).toEqual(new Map([['m-1', 'kairos']]))
    expect(calls().filter((c) => c.kind === 'select').every((c) => c.via === 'tx')).toBe(true)
  })

  it('writes nothing when the belief is no longer held or decide declines', async () => {
    state.selectQueue.push([])
    expect(await mutateHeldBelief(USER, OLD, () => { throw new Error('not called') }, null, NOW)).toEqual([])
    state.selectQueue.push([{ id: OLD, sourceMetadata: { belief: belief() }, links: [], invalidAt: null }])
    expect(await mutateHeldBelief(USER, OLD, () => null, null, NOW)).toEqual([])
    expect(calls().some((c) => c.kind === 'update')).toBe(false)
    expect(insertMemoryOps).not.toHaveBeenCalled()
  })
})

describe('listFlaggedAlignedBeliefs', () => {
  it('reads held aligned flagged beliefs, skipping retire-vetoed ones and unparseable rows', async () => {
    const flagged = belief({ recheck: { since: '2026-09-30T00:00:00.000Z', lostSources: [{ id: 'm-1', state: 'missing' }] } })
    state.selectQueue.push([{ id: OLD, sourceMetadata: { belief: flagged } }, { id: NEW, sourceMetadata: { belief: belief() } }])
    const out = await listFlaggedAlignedBeliefs(USER)
    expect(out.map((r) => r.id)).toEqual([OLD])
    const q = dialect.sqlToQuery(calls()[0].where as SQL)
    expect(q.sql).toContain("'recheck') IS NOT NULL")
    expect(q.sql).toContain("'retire') IS NULL")
  })

  it('orders never-presented flags first, then least recently presented', async () => {
    state.selectQueue.push([])
    await listFlaggedAlignedBeliefs(USER, 20, ['p-old', 'p-new'])
    const [first] = calls()[0].orderBy as SQL[]
    const q = dialect.sqlToQuery(first)
    expect(q.sql).toMatch(/COALESCE\(array_position\(ARRAY\[\$1, \$2\]::text\[\], "memories"\."id"::text\), 0\) ASC/)
    expect(q.params).toEqual(['p-old', 'p-new'])
  })
})
