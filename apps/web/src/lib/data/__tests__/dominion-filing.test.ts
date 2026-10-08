import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableName, type SQL, type Table } from 'drizzle-orm'

// Living Dominions filing + membership sync: repo resolution reads active
// dominion_members first (live Dominions, weight then age), falls back to
// dominion_repos deterministically; owner writes mirror into dominion_members.

type Op = { op: string; table?: string; values?: unknown; set?: unknown; where?: SQL; orderBy?: unknown[]; joins: SQL[]; conflict?: string }

const selectQueue: unknown[][] = []
const writeQueue: unknown[][] = []
const ops: Op[] = []

vi.mock('@/lib/db', () => {
  function chain(op: Op, rows: () => unknown[]) {
    ops.push(op)
    const c: Record<string, unknown> = {}
    c.from = (t: Table) => { op.table = getTableName(t); return c }
    c.innerJoin = (_t: Table, on: SQL) => { op.joins.push(on); return c }
    c.leftJoin = (_t: Table, on: SQL) => { op.joins.push(on); return c }
    c.where = (w: SQL) => { op.where = w; return c }
    c.orderBy = (...o: unknown[]) => { op.orderBy = o; return c }
    c.limit = () => c
    c.values = (v: unknown) => { op.values = v; return c }
    c.set = (s: unknown) => { op.set = s; return c }
    c.onConflictDoNothing = () => { op.conflict = 'nothing'; return c }
    c.onConflictDoUpdate = (cfg: { set: unknown }) => { op.conflict = 'update'; op.set = cfg.set; return c }
    c.returning = () => c
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return c
  }
  const exec = {
    select: vi.fn(() => chain({ op: 'select', joins: [] }, () => selectQueue.shift() ?? [])),
    insert: vi.fn((t: Table) => chain({ op: 'insert', table: getTableName(t), joins: [] }, () => writeQueue.shift() ?? [])),
    update: vi.fn((t: Table) => chain({ op: 'update', table: getTableName(t), joins: [] }, () => writeQueue.shift() ?? [])),
    delete: vi.fn((t: Table) => chain({ op: 'delete', table: getTableName(t), joins: [] }, () => writeQueue.shift() ?? [])),
  }
  const db = { ...exec, transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(exec)) }
  return { db }
})

import { db } from '@/lib/db'
import {
  resolveDominionByRepo,
  resolveDominionForMemory,
  addDominionRepo,
  removeDominionRepo,
  updateDominion,
} from '../dominions'

const dialect = new PgDialect()
const q = (s: SQL) => dialect.sqlToQuery(s)

beforeEach(() => {
  selectQueue.length = 0
  writeQueue.length = 0
  ops.length = 0
  vi.clearAllMocks()
})

describe('resolveDominionByRepo', () => {
  it('prefers an active repo member in a non-archived Dominion, by weight then age', async () => {
    selectQueue.push([{ dominionId: 'dom-other', ref: 'swarm' }, { dominionId: 'dom-member', ref: 'hydra' }])
    expect(await resolveDominionByRepo('u1', 'hydra')).toBe('dom-member')
    expect(ops).toHaveLength(1)
    const [sel] = ops
    expect(sel.table).toBe('dominion_members')
    const where = q(sel.where!)
    expect(where.params).toEqual(expect.arrayContaining(['u1', 'repo', 'active']))
    const join = q(sel.joins[0])
    expect(join.sql).toMatch(/"archived_at" is null/)
    const order = sel.orderBy!.map((o) => q(o as SQL).sql)
    expect(order[0]).toMatch(/"weight" desc/)
    expect(order[1]).toMatch(/"created_at" asc/)
  })

  it('falls back to dominion_repos in a deterministic order, skipping archived Dominions', async () => {
    selectQueue.push([], [{ dominionId: 'dom-legacy', repoSlug: 'hydra' }])
    expect(await resolveDominionByRepo('u1', 'hydra')).toBe('dom-legacy')
    expect(ops.map((o) => o.table)).toEqual(['dominion_members', 'dominion_repos'])
    const order = ops[1].orderBy!.map((o) => q(o as SQL).sql)
    expect(order[0]).toMatch(/"created_at" asc/)
    expect(order[1]).toMatch(/"id" asc/)
    expect(q(ops[1].joins[0]).sql).toMatch(/"archived_at" is null/i)
  })

  it('returns null when neither source maps the slug', async () => {
    expect(await resolveDominionByRepo('u1', 'nowhere')).toBeNull()
  })
})

describe('resolveDominionForMemory — project step', () => {
  it('uses the project Dominion when it is live', async () => {
    selectQueue.push([{ dominionId: 'dom-p', archivedAt: null }])
    expect(await resolveDominionForMemory('u1', { projectId: 'p1' })).toBe('dom-p')
    expect(q(ops[0].joins[0]).params).toContain('u1')
  })

  it("ignores a project Dominion owned by someone else (the join finds no row of the user's)", async () => {
    selectQueue.push([{ dominionId: null, archivedAt: null }])
    expect(await resolveDominionForMemory('u1', { projectId: 'p1' })).toBeNull()
  })

  it('skips an archived project Dominion and falls through to the repo', async () => {
    selectQueue.push([{ dominionId: 'dom-old', archivedAt: new Date() }], [{ dominionId: 'dom-repo', ref: 'hydra' }])
    const out = await resolveDominionForMemory('u1', { projectId: 'p1', sourceMetadata: { repo: 'hydra' } })
    expect(out).toBe('dom-repo')
  })

  it('returns null for an archived project Dominion with nothing else to go on', async () => {
    selectQueue.push([{ dominionId: 'dom-old', archivedAt: new Date() }])
    expect(await resolveDominionForMemory('u1', { projectId: 'p1' })).toBeNull()
  })

  it('an explicit dominionId still short-circuits', async () => {
    expect(await resolveDominionForMemory('u1', { dominionId: 'dom-x', projectId: 'p1' })).toBe('dom-x')
    expect(ops).toHaveLength(0)
  })
})

describe('resolveDominionForMemory — repo step', () => {
  it('files a git digest that carries only repoSlug', async () => {
    selectQueue.push([{ dominionId: 'dom-swarm', ref: 'shadow_app_swarm' }])
    const out = await resolveDominionForMemory('u1', { sourceMetadata: { kind: 'repo_git_digest', repoSlug: 'shadow_app_swarm' } })
    expect(out).toBe('dom-swarm')
  })

  it('matches a path-shaped repo against a folder-slug member', async () => {
    selectQueue.push([{ dominionId: 'dom-stp', ref: 'stp_app_ermac' }])
    const out = await resolveDominionForMemory('u1', { sourceMetadata: { repo: 'sefe/Short Term Power/stp_app_ermac' } })
    expect(out).toBe('dom-stp')
  })

  it('matches a board-label alias in either direction', async () => {
    selectQueue.push([{ dominionId: 'dom-aeon', ref: 'aeon' }])
    expect(await resolveDominionForMemory('u1', { sourceMetadata: { repoSlug: 'shadow_app_aeon' } })).toBe('dom-aeon')
    selectQueue.push([], [{ dominionId: 'dom-aeon-legacy', repoSlug: 'shadow_app_aeon' }])
    expect(await resolveDominionForMemory('u1', { sourceMetadata: { repo: 'repo:aeon' } })).toBe('dom-aeon-legacy')
  })

  it('prefers meta.repo over meta.repoSlug', async () => {
    selectQueue.push([{ dominionId: 'dom-hydra', ref: 'hydra' }, { dominionId: 'dom-swarm', ref: 'swarm' }])
    const out = await resolveDominionForMemory('u1', { sourceMetadata: { repo: 'hydra', repoSlug: 'swarm' } })
    expect(out).toBe('dom-hydra')
  })

  it('a live project Dominion still wins over the repo', async () => {
    selectQueue.push([{ dominionId: 'dom-p', archivedAt: null }])
    const out = await resolveDominionForMemory('u1', { projectId: 'p1', sourceMetadata: { repoSlug: 'hydra' } })
    expect(out).toBe('dom-p')
    expect(ops).toHaveLength(1)
  })
})

describe('repo membership sync', () => {
  it('addDominionRepo writes the mirror and an owner/active member in one transaction', async () => {
    selectQueue.push([{ id: 'd1' }])
    writeQueue.push([{ dominionId: 'd1', repoSlug: 'hydra' }], [])
    const row = await addDominionRepo('d1', 'u1', 'hydra')
    expect(row).toEqual({ dominionId: 'd1', repoSlug: 'hydra' })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    const inserts = ops.filter((o) => o.op === 'insert')
    expect(inserts.map((o) => o.table)).toEqual(['dominion_repos', 'dominion_members'])
    expect(inserts[1].values).toMatchObject({ userId: 'u1', dominionId: 'd1', kind: 'repo', ref: 'hydra', source: 'owner', status: 'active' })
    expect(inserts[1].conflict).toBe('update')
    expect(inserts[1].set).toMatchObject({ status: 'active' })
  })

  it('addDominionRepo on a foreign Dominion writes nothing', async () => {
    selectQueue.push([])
    expect(await addDominionRepo('d1', 'u1', 'hydra')).toBeNull()
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('removeDominionRepo deletes the mirror and the member row together', async () => {
    selectQueue.push([{ id: 'd1' }])
    writeQueue.push([{ dominionId: 'd1' }], [])
    expect(await removeDominionRepo('d1', 'u1', 'hydra')).toBe(true)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    const deletes = ops.filter((o) => o.op === 'delete')
    expect(deletes.map((o) => o.table)).toEqual(['dominion_repos', 'dominion_members'])
    expect(q(deletes[1].where!).params).toEqual(expect.arrayContaining(['u1', 'repo', 'hydra', 'd1']))
  })
})

describe('updateDominion — pinned', () => {
  it('pinning also wakes the Dominion', async () => {
    writeQueue.push([{ id: 'd1', pinned: true }])
    await updateDominion('d1', 'u1', { pinned: true })
    expect(ops[0].set).toMatchObject({ pinned: true, focusState: 'active' })
  })

  it('unpinning leaves focusState alone', async () => {
    writeQueue.push([{ id: 'd1', pinned: false }])
    await updateDominion('d1', 'u1', { pinned: false })
    expect(ops[0].set).toMatchObject({ pinned: false })
    expect(ops[0].set).not.toHaveProperty('focusState')
  })

  it('omitting pinned touches neither column', async () => {
    writeQueue.push([{ id: 'd1' }])
    await updateDominion('d1', 'u1', { name: 'X' })
    expect(ops[0].set).not.toHaveProperty('pinned')
    expect(ops[0].set).not.toHaveProperty('focusState')
  })
})
