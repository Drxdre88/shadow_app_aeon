import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core'

// Recording fake of the Drizzle client (mirrors concepts.test.ts): every
// builder call is logged with its WHERE rendered by the real pg dialect, each
// awaited statement resolves the next queued result, and transaction
// boundaries are logged. Never touches a database.
type Entry = { op: string; table?: string; where?: string; params?: unknown[]; values?: unknown; set?: unknown; tx?: boolean }
const state = vi.hoisted(() => ({ results: [] as unknown[], log: [] as Entry[], inTx: false }))

vi.mock('@/lib/db', () => {
  const dialect = new PgDialect()
  function builder(entry: Entry) {
    entry.tx = state.inTx
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
      state.log.push({ op: 'execute', tx: state.inTx })
      return { rows: [] }
    },
    transaction: async (fn: (tx: unknown) => unknown) => {
      state.log.push({ op: 'begin' })
      state.inTx = true
      try {
        return await fn(db)
      } finally {
        state.inTx = false
        state.log.push({ op: 'commit' })
      }
    },
  }
  return { db }
})

vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { validAsOfNow: sql`("memories"."invalid_at" is null)` }
})

import { acceptConstitutionProposalTx, insertConstitutionProposal, insertDriftObservation } from '../constitution'
import { decideConstitutionAcceptance } from '@/lib/kairos/constitution/amendment'

const USER = 'user-1'
const PROPOSAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-01T08:00:00Z')

const proposalRow = (basedOnVersion: number, status = 'pending') => ({
  id: PROPOSAL,
  type: 'inbound',
  sourceMetadata: {
    introspection: true,
    kind: 'constitution_amendment',
    status,
    constitution: { principles: [{ n: 1, text: 'Tell the truth', reason: 'Trust compounds' }], basedOnVersion, rationale: 'r' },
  },
})

const liveRow = {
  id: 'live-1',
  title: 'Constitution v1',
  bodyMd: '',
  createdAt: NOW,
  supersededAt: null,
  sourceMetadata: { constitution: { version: 1, principles: [{ n: 1, text: 'Old', reason: 'Old' }], acceptedFrom: 'p0' } },
}

const decide = (p: Parameters<typeof decideConstitutionAcceptance>[0], l: Parameters<typeof decideConstitutionAcceptance>[1]) =>
  decideConstitutionAcceptance(p, l, NOW)

const writes = () => state.log.filter((e) => e.op === 'insert' || e.op === 'update')

beforeEach(() => {
  state.results = []
  state.log = []
  state.inTx = false
})

describe('acceptConstitutionProposalTx', () => {
  it('writes v(n+1), supersedes the live version, closes the proposal and logs the op — all in one transaction', async () => {
    // applied? → none; proposal; live; insert returning; 3 awaited writes.
    state.results.push([], [proposalRow(1)], [liveRow], [{ id: 'new-c' }], undefined, undefined, undefined)
    const res = await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)
    expect(res).toEqual({ ok: true, constitutionId: 'new-c', version: 2, supersededId: 'live-1', alreadyApplied: false })

    expect(state.log[0].op).toBe('begin')
    expect(state.log.at(-1)?.op).toBe('commit')
    expect(state.log.filter((e) => e.op === 'begin')).toHaveLength(1)
    expect(state.log[1]).toMatchObject({ op: 'execute', tx: true })
    for (const w of writes()) expect(w.tx).toBe(true)

    const [insertC, supersede, closeProposal, op] = writes()
    expect(insertC).toMatchObject({ op: 'insert', table: 'memories' })
    expect(insertC.values).toMatchObject({
      type: 'constitution',
      streamClass: 'constitution',
      confidence: 0.95,
      pinned: true,
      title: 'Constitution v2',
      sourceMetadata: { constitution: { version: 2, acceptedFrom: PROPOSAL } },
    })
    expect(supersede).toMatchObject({ op: 'update', table: 'memories' })
    expect(supersede.set).toMatchObject({ supersededAt: NOW, supersededById: 'new-c', invalidAt: NOW })
    expect(supersede.params).toContain('live-1')
    expect(closeProposal.set).toMatchObject({ archivedAt: NOW, sourceMetadata: { status: 'accepted', constitutionId: 'new-c' } })
    expect(closeProposal.params).toContain(PROPOSAL)
    expect(op).toMatchObject({ op: 'insert', table: 'memory_ops' })
    expect(op.values).toMatchObject({
      userId: USER,
      memoryId: 'new-c',
      step: 'constitution',
      op: 'promote',
      before: null,
      after: { version: 2, acceptedFrom: PROPOSAL, supersededId: 'live-1' },
    })
  })

  it('writes v1 with no supersede when there is no live version', async () => {
    state.results.push([], [proposalRow(0)], [], [{ id: 'new-c' }], undefined, undefined)
    const res = await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)
    expect(res).toMatchObject({ ok: true, version: 1, supersededId: null })
    expect(writes().map((w) => `${w.op}:${w.table}`)).toEqual(['insert:memories', 'update:memories', 'insert:memory_ops'])
  })

  it('is idempotent: an already-applied proposal returns its version and writes nothing', async () => {
    state.results.push([{ id: 'c-existing', sourceMetadata: { constitution: { version: 4 } }, supersededAt: null }])
    const res = await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)
    expect(res).toEqual({ ok: true, constitutionId: 'c-existing', version: 4, supersededId: null, alreadyApplied: true })
    expect(writes()).toEqual([])
    const probe = state.log.find((e) => e.op === 'select')
    expect(probe?.where).toContain(`->'constitution'->>'acceptedFrom'`)
    expect(probe?.params).toContain(PROPOSAL)
  })

  it('writes nothing when the proposal is missing or refused', async () => {
    state.results.push([], [])
    expect(await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)).toEqual({ ok: false, reason: 'not_found' })
    state.results.push([], [proposalRow(0)], [liveRow])
    expect(await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)).toEqual({ ok: false, reason: 'stale_amendment' })
    state.results.push([], [proposalRow(1, 'accepted')], [liveRow])
    expect(await acceptConstitutionProposalTx(USER, PROPOSAL, decide, NOW)).toEqual({ ok: false, reason: 'not_pending' })
    expect(writes()).toEqual([])
  })
})

describe('insertConstitutionProposal', () => {
  const values = {
    title: 'Constitution draft v1',
    bodyMd: '# Draft',
    summary: 'Draft',
    source: 'cron',
    links: [],
    tags: ['proposal', 'constitution'],
    sourceMetadata: { introspection: true, kind: 'constitution_amendment', status: 'pending' },
  }

  it('writes an inbound agentic proposal', async () => {
    state.results.push([{ id: 'p1' }])
    expect(await insertConstitutionProposal(USER, values)).toEqual({ written: true, memoryId: 'p1' })
    const [ins] = writes()
    expect(ins.values).toMatchObject({ type: 'inbound', streamClass: 'agentic', source: 'cron', pinned: false })
  })

  it('first-draft mode skips under the lock when a constitution or a pending amendment exists', async () => {
    state.results.push([{ id: 'live' }])
    expect(await insertConstitutionProposal(USER, values, { firstDraftOnly: true }))
      .toEqual({ written: false, memoryId: null, skipped: 'constitution_exists' })
    state.results.push([], [{ id: 'pending' }])
    expect(await insertConstitutionProposal(USER, values, { firstDraftOnly: true }))
      .toEqual({ written: false, memoryId: null, skipped: 'pending_draft_exists' })
    expect(writes()).toEqual([])
    const pendingProbe = state.log.filter((e) => e.op === 'select').at(-1)
    expect(pendingProbe?.where).toContain(`->>'kind' = $`)
    expect(pendingProbe?.params).toEqual(expect.arrayContaining(['constitution_amendment', 'inbound']))
  })
})

describe('insertDriftObservation', () => {
  it('writes a trace observation once per externalKey', async () => {
    state.results.push([], [{ id: 'd1' }])
    const v = { kind: 'drift_run' as const, externalKey: 'drift_run:2026-10-01', title: 't', bodyMd: 'b', summary: 's', sourceMetadata: { drift: {} } }
    expect(await insertDriftObservation(USER, v)).toEqual({ memoryId: 'd1', written: true })
    expect(writes()[0].values).toMatchObject({
      type: 'observation',
      streamClass: 'trace',
      sourceMetadata: { kind: 'drift_run', externalKey: 'drift_run:2026-10-01' },
    })
    state.results.push([{ id: 'd1' }])
    expect(await insertDriftObservation(USER, v)).toEqual({ memoryId: 'd1', written: false })
    expect(writes()).toHaveLength(1)
  })
})
