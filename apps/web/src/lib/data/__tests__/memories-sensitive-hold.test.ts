import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Private-topic hold on the memories write and read paths: with the gate on,
// a matching row is held whatever the caller passes, agent edits re-run the
// check, owner edits do not, and live readers carry the held predicate.

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as Record<string, unknown>[],
  sets: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  executed: [] as unknown[],
}))

vi.mock('@/lib/db', () => {
  function selectChain() {
    const rows = h.selectQueue.shift() ?? []
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.for = pass
    chain.where = (w: unknown) => { h.wheres.push(w); return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function insertChain() {
    let last: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.values = (v: Record<string, unknown>) => { last = v; h.inserts.push(v); return chain }
    chain.returning = () => Promise.resolve([{ id: 'mem-1', ...last }])
    return chain
  }
  function updateChain() {
    let patch: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.set = (p: Record<string, unknown>) => { patch = p; h.sets.push(p); return chain }
    chain.where = () => chain
    chain.returning = () => Promise.resolve([{ id: 'mem-1', ...patch }])
    return chain
  }
  const execute = vi.fn(async (q: unknown) => { h.executed.push(q); return { rows: [] } })
  const select = vi.fn(selectChain)
  const insert = vi.fn(insertChain)
  const update = vi.fn(updateChain)
  return { db: { select, insert, update, execute, transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ select, insert, update, execute })) } }
})
vi.mock('../dominions', () => ({ resolveDominionForMemory: vi.fn(async () => null) }))
vi.mock('@/lib/data/kairos-sensitive', () => ({ getSensitiveGate: vi.fn(async () => true) }))

import { captureReflection, createMemory, getNeighbours, listRecentMemories, updateMemory } from '../memories'
import { fetchMemoriesByIds, writeFloatingReflection } from '../dialogue'

const USER = 'user-1'
const DOMINION = 'b0000000-0000-4000-8000-000000000002'
const HELD_SQL = `->>'sensitiveHeld') IS DISTINCT FROM 'true'`
const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL).sql
const metaOf = (v: Record<string, unknown> | undefined) => v?.sourceMetadata as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  h.selectQueue = []
  h.inserts = []
  h.sets = []
  h.wheres = []
  h.executed = []
})

describe('capture with the gate on', () => {
  it('createMemory holds a matching row even when the caller passes sensitiveHeld:false', async () => {
    await createMemory(USER, {
      title: 'Evening', bodyMd: 'Saw my therapist today', type: 'note', source: 'claude', dominionId: DOMINION,
      sourceMetadata: { sensitiveHeld: false },
    })
    expect(metaOf(h.inserts[0])).toMatchObject({ sensitive: true, sensitiveHeld: true, sensitiveTopics: ['health'] })
  })

  it('captureReflection holds a matching row even when the caller passes sensitiveHeld:false', async () => {
    h.selectQueue.push([{ id: DOMINION, name: 'Life' }])
    const res = await captureReflection(USER, { dominionId: DOMINION, bodyMd: 'Argued with my wife', sourceMetadata: { sensitiveHeld: false } })
    expect(res.ok).toBe(true)
    expect(metaOf(h.inserts[0])).toMatchObject({ sensitiveHeld: true, sensitiveTopics: ['relationships'] })
  })

  it('a floating dialogue reflection is held too', async () => {
    await writeFloatingReflection(USER, { bodyMd: 'The mortgage and my debts', sourceMetadata: { sensitiveHeld: false, origin: { kind: 'kairos' } } })
    expect(metaOf(h.inserts[0])).toMatchObject({ kairosReflect: true, sensitiveHeld: true, sensitiveTopics: ['money'], origin: { kind: 'kairos' } })
  })

  it('leaves a non-matching floating reflection unstamped', async () => {
    await writeFloatingReflection(USER, { bodyMd: 'Ship the board refactor' })
    expect(metaOf(h.inserts[0])).toEqual({ kairosReflect: true })
  })
})

describe('updateMemory re-check', () => {
  const row = { id: 'mem-1', userId: USER, title: 'Old', bodyMd: 'old', summary: null, type: 'note', streamClass: 'idea', source: 'manual', sourceMetadata: { sensitiveHeld: false } }

  it('re-holds a row an agent rewrites into a private topic', async () => {
    h.selectQueue.push([row])
    await updateMemory('mem-1', USER, { bodyMd: 'Booked surgery at the hospital' }, { origin: { kind: 'agent', via: 'mcp' } })
    expect(metaOf(h.sets[0])).toMatchObject({ sensitiveHeld: true, sensitiveTopics: ['health'] })
  })

  it('never holds the owner\u2019s own edit', async () => {
    h.selectQueue.push([row])
    await updateMemory('mem-1', USER, { bodyMd: 'Booked surgery at the hospital' }, { origin: { kind: 'operator', via: 'ui-fix' } })
    expect(metaOf(h.sets[0]).sensitiveHeld).toBe(false)
  })
})

describe('live readers carry the held predicate', () => {
  it('getNeighbours liveOnly filters held rows on both walks', async () => {
    await getNeighbours('mem-1', USER, { liveOnly: true })
    expect(h.executed).toHaveLength(2)
    expect(render(h.executed[0])).toContain(`(m2.source_metadata${HELD_SQL}`)
    expect(render(h.executed[1])).toContain(`(m.source_metadata${HELD_SQL}`)
  })

  it('getNeighbours without liveOnly keeps browsing history', async () => {
    await getNeighbours('mem-1', USER)
    expect(h.executed.map(render).join('\n')).not.toContain('sensitiveHeld')
  })

  it('listRecentMemories filters held rows', async () => {
    await listRecentMemories(USER, [], { start: new Date(0), end: new Date() }, 5)
    expect(render(h.wheres[0])).toContain(`("memories"."source_metadata"${HELD_SQL}`)
  })

  it('fetchMemoriesByIds (dialogue and dream-read grounding) filters held rows', async () => {
    await fetchMemoriesByIds(USER, ['mem-1'])
    expect(render(h.wheres[0])).toContain(`("memories"."source_metadata"${HELD_SQL}`)
  })
})
