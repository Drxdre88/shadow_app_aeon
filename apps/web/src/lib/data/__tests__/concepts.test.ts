import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core'

// Recording fake of the Drizzle client: each builder call is logged (WHERE
// rendered with the real pg dialect) and each awaited statement resolves the
// next queued result. Never touches a database.
type Entry = { op: string; table?: string; where?: string; params?: unknown[]; values?: unknown; set?: unknown; limit?: number }
const state = vi.hoisted(() => ({ results: [] as unknown[], log: [] as Entry[] }))

vi.mock('@/lib/db', () => {
  const dialect = new PgDialect()
  function builder(entry: Entry) {
    state.log.push(entry)
    const b: Record<string, unknown> = {}
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === 'from') entry.table = getTableName(args[0] as PgTable)
      if (name === 'where' && args[0]) {
        const q = dialect.sqlToQuery(args[0] as SQL)
        entry.where = q.sql
        entry.params = q.params
      }
      if (name === 'values') entry.values = args[0]
      if (name === 'set') entry.set = args[0]
      if (name === 'limit') entry.limit = args[0] as number
      return b
    }
    for (const m of ['from', 'where', 'orderBy', 'limit', 'for', 'values', 'set', 'returning']) b[m] = chain(m)
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(state.results.shift()).then(res, rej)
    return b
  }
  const db = {
    select: () => builder({ op: 'select' }),
    insert: (t: PgTable) => builder({ op: 'insert', table: getTableName(t) }),
    update: (t: PgTable) => builder({ op: 'update', table: getTableName(t) }),
    execute: async () => {
      state.log.push({ op: 'execute' })
      return { rows: [] }
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})

vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`("memories"."invalid_at" is null)` }
})

import {
  CONCEPT_CANDIDATE_CAP,
  CONCEPT_HISTORY_CAP,
  createConceptWithOp,
  listConceptCandidates,
  listConceptHistory,
  memberIdsFromLinks,
  updateConceptWithOp,
  type ConceptWriteValues,
} from '../concepts'

const values: ConceptWriteValues = {
  dominionId: 'dom',
  externalKey: 'concept:dom:2026-W40:abc',
  title: 'Idea',
  bodyMd: '# Idea',
  summary: 'Idea',
  type: 'concept',
  streamClass: 'concept',
  confidence: 0.7,
  links: [{ type: 'refers_to', target: 'm1', target_kind: 'memory' }],
  tags: ['concept'],
  sourceMetadata: { kind: 'concept' },
}

const liveRow = {
  id: 'c1',
  title: 'Old',
  bodyMd: '# Old',
  summary: 'Old',
  confidence: 0.6,
  links: [],
  tags: ['concept'],
  sourceMetadata: { kind: 'concept', weekKey: '2026-W39' },
}

beforeEach(() => {
  state.results = []
  state.log = []
})

describe('listConceptCandidates', () => {
  it('scopes to live, embedded, non-meta, non-synthesis rows of one Dominion and caps the pool', async () => {
    state.results.push([
      { id: 'a', embedding: [0.1, 0.2] },
      { id: 'b', embedding: null },
    ])
    const rows = await listConceptCandidates('u', 'dom', 10_000)
    expect(rows.map((r) => r.id)).toEqual(['a'])
    const [q] = state.log
    expect(q.table).toBe('memories')
    expect(q.limit).toBe(CONCEPT_CANDIDATE_CAP)
    for (const clause of ['"embedding" is not null', '"superseded_at" is null', '"archived_at" is null', '"invalid_at" is null']) {
      expect(q.where).toContain(clause)
    }
    expect(q.where).toMatch(/"type" not in/)
    expect(q.where).toMatch(/"stream_class" not in/)
    // Concept-tier rows (even accepted ones re-typed to 'observation') are never members.
    expect(q.where).toContain(`("memories"."source_metadata"->>'kind') IS DISTINCT FROM 'concept'`)
    expect(q.params).toEqual(expect.arrayContaining(['u', 'dom', 'concept', 'inbound', 'dominion_cortex', 'trace', 'delta', 'snapshot', 'aether', 'archetype']))
  })
})

describe('listConceptHistory', () => {
  it('returns every concept-tier row regardless of status/archive/supersede, classed live or resolved', async () => {
    state.results.push([
      { id: 'c1', type: 'concept', pinned: false, archivedAt: null, supersededAt: null, sourceMetadata: { kind: 'concept' }, links: [{ type: 'refers_to', target: 'm1' }, { type: 'relates', target: 'x' }] },
      { id: 'p1', type: 'inbound', pinned: false, archivedAt: null, supersededAt: null, sourceMetadata: { kind: 'concept', status: 'pending' }, links: [{ type: 'refers_to', target: 'm2' }] },
      { id: 'dismissed', type: 'inbound', pinned: false, archivedAt: new Date(), supersededAt: null, sourceMetadata: { kind: 'concept', status: 'pending' }, links: [] },
      { id: 'accepted', type: 'observation', pinned: false, archivedAt: null, supersededAt: null, sourceMetadata: { kind: 'concept', status: 'accepted' }, links: [] },
      { id: 'promoted', type: 'inbound', pinned: false, archivedAt: null, supersededAt: null, sourceMetadata: { kind: 'concept', status: 'promoted' }, links: [] },
      { id: 'superseded', type: 'concept', pinned: false, archivedAt: null, supersededAt: new Date(), sourceMetadata: null, links: [] },
    ])
    const rows = await listConceptHistory('u', 'dom')
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['c1', 'live'],
      ['p1', 'live'],
      ['dismissed', 'resolved'],
      ['accepted', 'resolved'],
      ['promoted', 'resolved'],
      ['superseded', 'resolved'],
    ])
    expect(rows[0]).toEqual({ id: 'c1', isProposal: false, pinned: false, memberIds: ['m1'], state: 'live' })
    expect(rows[1].isProposal).toBe(true)
    const where = state.log[0].where!
    expect(where).toContain(`->>'kind' = 'concept'`)
    expect(where).not.toContain('"archived_at" is null')
    expect(where).not.toContain('"superseded_at" is null')
    expect(where).not.toContain(`'status'`)
    expect(state.log[0].limit).toBe(CONCEPT_HISTORY_CAP)
  })

  it('memberIdsFromLinks tolerates junk', () => {
    expect(memberIdsFromLinks(null)).toEqual([])
    expect(memberIdsFromLinks([{ type: 'refers_to', target: 'a' }, { type: 'refers_to', target: 'a' }, 'x', { type: 'refers_to' }])).toEqual(['a'])
  })
})

describe('createConceptWithOp', () => {
  it('inserts the concept and a concept_create op in one transaction', async () => {
    state.results.push([], [{ id: 'new', ...values }], undefined)
    const out = await createConceptWithOp('u', 'run-uuid', values, { step: 'concepts', reason: 'r' })
    expect(out).toEqual({ memoryId: 'new', written: true })
    const inserts = state.log.filter((e) => e.op === 'insert')
    expect(inserts.map((e) => e.table)).toEqual(['memories', 'memory_ops'])
    expect(inserts[0].values).toMatchObject({ type: 'concept', streamClass: 'concept', source: 'cron', sourceMetadata: { externalKey: values.externalKey } })
    expect(inserts[1].values).toMatchObject({ userId: 'u', runId: 'run-uuid', memoryId: 'new', op: 'concept_create', before: null, step: 'concepts' })
  })

  it('is a no-op when the externalKey was already written', async () => {
    state.results.push([{ id: 'existing' }])
    const out = await createConceptWithOp('u', null, values, { step: 'concepts', reason: 'r' })
    expect(out).toEqual({ memoryId: 'existing', written: false })
    expect(state.log.some((e) => e.op === 'insert')).toBe(false)
  })
})

describe('updateConceptWithOp', () => {
  it('updates a live unpinned concept in place, re-nulls its embedding, logs before/after', async () => {
    state.results.push([], [liveRow], [{ ...liveRow, ...values, id: 'c1' }], undefined)
    const out = await updateConceptWithOp('u', 'run-uuid', 'c1', values, { step: 'concepts', reason: 'r' })
    expect(out).toEqual({ memoryId: 'c1', written: true })
    const select = state.log.filter((e) => e.op === 'select')[1]
    expect(select.where).toContain('"pinned" = $')
    expect(select.where).toContain('"superseded_at" is null')
    const update = state.log.find((e) => e.op === 'update')!
    expect(update.set).toMatchObject({ embedding: null, title: 'Idea', sourceMetadata: { weekKey: '2026-W39', kind: 'concept', externalKey: values.externalKey } })
    const op = state.log.find((e) => e.op === 'insert')!
    expect(op.table).toBe('memory_ops')
    expect(op.values).toMatchObject({ op: 'concept_update', memoryId: 'c1', before: { title: 'Old', bodyMd: '# Old' }, after: { title: 'Idea' } })
  })

  it('returns null when the target is gone, superseded or pinned', async () => {
    state.results.push([], [])
    expect(await updateConceptWithOp('u', null, 'c1', values, { step: 'concepts', reason: 'r' })).toBeNull()
    expect(state.log.some((e) => e.op === 'update' || e.op === 'insert')).toBe(false)
  })
})
