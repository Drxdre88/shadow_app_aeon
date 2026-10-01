import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core'

// Recording fake of the Drizzle client (mirrors constitution.test.ts): each
// awaited statement resolves the next queued result; WHEREs are rendered by
// the real pg dialect. Never touches a database.
type Entry = { op: string; table?: string; where?: string; params?: unknown[]; values?: unknown; set?: Record<string, unknown> }
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
      if (name === 'set') entry.set = args[0] as Record<string, unknown>
      return b
    }
    for (const m of ['from', 'where', 'orderBy', 'limit', 'values', 'set', 'returning']) b[m] = chain(m)
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(state.results.shift()).then(res, rej)
    return b
  }
  const db = {
    select: () => builder({ op: 'select' }),
    insert: (t: PgTable) => builder({ op: 'insert', table: getTableName(t) }),
    update: (t: PgTable) => builder({ op: 'update', table: getTableName(t) }),
    execute: async () => ({ rows: [] }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})

import {
  findLatestConscienceRun,
  findLatestDriftRun,
  listProvenanceOrigins,
  writeDriftRunSection,
} from '../constitution-drift'

const USER = 'user-1'
const writes = () => state.log.filter((e) => e.op === 'insert' || e.op === 'update')
const values = (section: 'drift' | 'conscience') => ({
  externalKey: 'drift_run:2026-10-01',
  section,
  patch: { [section]: { v: 1 } },
  title: `${section} title`,
  bodyMd: `${section} body`,
  summary: `${section} summary`,
})

beforeEach(() => {
  state.results.length = 0
  state.log.length = 0
})

describe('writeDriftRunSection', () => {
  it('inserts the day\'s drift_run when none exists', async () => {
    state.results.push([], [{ id: 'r1' }])
    expect(await writeDriftRunSection(USER, values('conscience'))).toEqual({ memoryId: 'r1', written: true })
    expect(writes()[0].values).toMatchObject({
      type: 'observation',
      streamClass: 'trace',
      source: 'cron',
      sourceMetadata: { conscience: { v: 1 }, kind: 'drift_run', externalKey: 'drift_run:2026-10-01' },
    })
  })

  it('merges a missing section in; drift takes the header, conscience only appends', async () => {
    state.results.push([{ id: 'r1', present: false, bodyMd: 'conscience body' }], undefined)
    expect(await writeDriftRunSection(USER, values('drift'))).toEqual({ memoryId: 'r1', written: true })
    const driftSet = writes()[0].set as Record<string, unknown>
    expect(driftSet).toMatchObject({ title: 'drift title', summary: 'drift summary', bodyMd: 'drift body\n\nconscience body' })

    state.log.length = 0
    state.results.push([{ id: 'r1', present: false, bodyMd: 'drift body' }], undefined)
    await writeDriftRunSection(USER, values('conscience'))
    const conscienceSet = writes()[0].set as Record<string, unknown>
    expect(conscienceSet.bodyMd).toBe('drift body\n\nconscience body')
    expect(conscienceSet).not.toHaveProperty('title')
    expect(conscienceSet).not.toHaveProperty('summary')
  })

  it('never overwrites a section already present', async () => {
    state.results.push([{ id: 'r1', present: true, bodyMd: 'x' }])
    expect(await writeDriftRunSection(USER, values('drift'))).toEqual({ memoryId: 'r1', written: false })
    expect(writes()).toEqual([])
  })
})

describe('latest-run readers', () => {
  it('only count a run that carries their section', async () => {
    state.results.push([], [])
    await findLatestDriftRun(USER)
    await findLatestConscienceRun(USER)
    const [drift, conscience] = state.log.filter((e) => e.op === 'select')
    expect(drift.params).toEqual(expect.arrayContaining(['drift_run', 'drift']))
    expect(conscience.params).toEqual(expect.arrayContaining(['drift_run', 'conscience']))
    expect(drift.where).toContain(`"source_metadata"->$5) IS NOT NULL`)
  })
})

describe('listProvenanceOrigins', () => {
  it('skips non-uuid ids and the query entirely when none remain', async () => {
    expect(await listProvenanceOrigins(USER, ['not-a-uuid', ''])).toEqual([])
    expect(state.log).toEqual([])
  })

  it('returns only the fields originKindOf reads', async () => {
    const id = '0d3c2f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'
    state.results.push([{ id, source: 'manual', origin: { kind: 'external' }, kind: null }])
    expect(await listProvenanceOrigins(USER, [id, id])).toEqual([{ id, source: 'manual', sourceMetadata: { origin: { kind: 'external' } } }])
  })
})
