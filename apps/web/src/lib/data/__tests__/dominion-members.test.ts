import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableName, type SQL, type Table } from 'drizzle-orm'

// Board membership follows project assignment (one transaction), and the
// focus read joins the ranked live list with unattributed recent work.

type Op = { op: string; table?: string; values?: unknown; set?: unknown; where?: SQL }

const selectQueue: unknown[][] = []
const writeQueue: unknown[][] = []
const ops: Op[] = []

vi.mock('@/lib/db', () => {
  function chain(op: Op, rows: () => unknown[]) {
    ops.push(op)
    const c: Record<string, unknown> = {}
    c.from = (t: Table) => { op.table = getTableName(t); return c }
    c.where = (w: SQL) => { op.where = w; return c }
    c.limit = () => c
    c.values = (v: unknown) => { op.values = v; return c }
    c.set = (s: unknown) => { op.set = s; return c }
    c.onConflictDoUpdate = (cfg: { set: unknown }) => { op.set = cfg.set; return c }
    c.returning = () => c
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return c
  }
  const exec = {
    select: vi.fn(() => chain({ op: 'select' }, () => selectQueue.shift() ?? [])),
    insert: vi.fn((t: Table) => chain({ op: 'insert', table: getTableName(t) }, () => writeQueue.shift() ?? [])),
    update: vi.fn((t: Table) => chain({ op: 'update', table: getTableName(t) }, () => writeQueue.shift() ?? [])),
    delete: vi.fn((t: Table) => chain({ op: 'delete', table: getTableName(t) }, () => writeQueue.shift() ?? [])),
  }
  return { db: { ...exec, transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(exec)) } }
})

const focus = vi.hoisted(() => ({
  listLiveDominions: vi.fn(),
  getUnattributedActivity: vi.fn(),
}))
vi.mock('../dominion-focus', () => ({ listLiveDominions: focus.listLiveDominions }))
vi.mock('../dominion-activity', () => ({ getUnattributedActivity: focus.getUnattributedActivity }))

import { db } from '@/lib/db'
import { assignProjectDominion, getDominionFocus, updateProjectAndBoardMembership } from '../dominion-members'

const q = (s: SQL) => new PgDialect().sqlToQuery(s)
const writes = () => ops.filter((o) => o.op !== 'select')
const shape = () => writes().map((o) => `${o.op}:${o.table}`)

beforeEach(() => {
  selectQueue.length = 0
  writeQueue.length = 0
  ops.length = 0
  vi.clearAllMocks()
  delete process.env.KAIROS_LIVING_DOMINIONS
})

describe('updateProjectAndBoardMembership — app/REST project edits', () => {
  it('applies every field and moves the board link in one transaction', async () => {
    writeQueue.push([{ id: 'p1', name: 'Renamed', dominionId: 'd-new' }], [], [])
    selectQueue.push([{ id: 'd-new' }])
    const out = await updateProjectAndBoardMembership('p1', 'u1', { name: 'Renamed', dominionId: 'd-new' }, 'd-new')
    expect(out).toMatchObject({ id: 'p1', dominionId: 'd-new' })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(shape()).toEqual(['update:projects', 'delete:dominion_members', 'insert:dominion_members'])
    expect(writes()[0].set).toMatchObject({ name: 'Renamed', dominionId: 'd-new' })
  })

  it('never links the caller to a Dominion they do not own', async () => {
    writeQueue.push([{ id: 'p1', name: 'Board', dominionId: 'd-theirs' }], [])
    selectQueue.push([])
    await updateProjectAndBoardMembership('p1', 'u1', { dominionId: 'd-theirs' }, 'd-theirs')
    expect(shape()).toEqual(['update:projects', 'delete:dominion_members'])
  })

  it('returns null and writes nothing else when the project is missing', async () => {
    writeQueue.push([])
    expect(await updateProjectAndBoardMembership('p1', 'u1', { dominionId: 'd-new' }, 'd-new')).toBeNull()
    expect(shape()).toEqual(['update:projects'])
  })
})

describe('assignProjectDominion — board membership sync', () => {
  it('drops every other active board link of the user and upserts the new one', async () => {
    writeQueue.push([{ id: 'p1', name: 'Board', dominionId: 'd-new' }], [], [])
    selectQueue.push([{ id: 'd-new' }])
    const out = await assignProjectDominion('p1', 'u1', 'd-new')
    expect(out).toMatchObject({ id: 'p1', dominionId: 'd-new' })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(shape()).toEqual(['update:projects', 'delete:dominion_members', 'insert:dominion_members'])
    const [upd, del, ins] = writes()
    expect(upd.set).toMatchObject({ dominionId: 'd-new' })
    const delQ = q(del.where!)
    expect(delQ.params).toEqual(expect.arrayContaining(['u1', 'board', 'p1', 'active', 'd-new']))
    expect(delQ.sql).toMatch(/"dominion_id" <>/)
    expect(ins.values).toMatchObject({ userId: 'u1', dominionId: 'd-new', kind: 'board', ref: 'p1', source: 'owner', status: 'active' })
    expect(ins.set).toMatchObject({ status: 'active' })
  })

  it('still clears the user\'s own stale link after another member moved the board', async () => {
    // projects.dominion_id was changed by a realm member; the delete no longer keys on it.
    writeQueue.push([{ id: 'p1', name: 'Board', dominionId: 'd-a2' }], [], [])
    selectQueue.push([{ id: 'd-a2' }])
    await assignProjectDominion('p1', 'u1', 'd-a2')
    const del = writes()[1]
    expect(q(del.where!).params).not.toContain('d-b1')
    expect(q(del.where!).params).toEqual(expect.arrayContaining(['u1', 'p1', 'd-a2']))
  })

  it('clearing removes all of the user\'s board links and adds none', async () => {
    writeQueue.push([{ id: 'p1', name: 'Board', dominionId: null }], [])
    await assignProjectDominion('p1', 'u1', null)
    expect(shape()).toEqual(['update:projects', 'delete:dominion_members'])
    expect(q(writes()[1].where!).sql).not.toMatch(/<>/)
  })

  it('returns null for a missing project without touching memberships', async () => {
    writeQueue.push([])
    expect(await assignProjectDominion('p1', 'u1', 'd1')).toBeNull()
    expect(shape()).toEqual(['update:projects'])
  })
})

describe('getDominionFocus', () => {
  const row = {
    id: 'd1', name: 'VORATH', activityScore: 4.2, lastActiveAt: new Date('2026-10-01'),
    focusState: 'active', pinned: true, dormant: false, activity: { sessions: 3 },
    userId: 'u1', color: 'purple', vision: 'secret body', sortOrder: 0,
  }
  const unattributed = { scoredAt: '2026-10-05T00:00:00Z', boards: [], repos: [{ slug: 'rift', score: 2 }] }

  it('returns mode, the live list ranked by activity in every mode, and unattributed work', async () => {
    process.env.KAIROS_LIVING_DOMINIONS = 'observe'
    focus.listLiveDominions.mockResolvedValue([{ ...row, id: 'd2', name: 'STP', activityScore: 1, pinned: false, dormant: true }, row])
    focus.getUnattributedActivity.mockResolvedValue(unattributed)
    const out = await getDominionFocus('u1')
    expect(focus.listLiveDominions).toHaveBeenCalledWith('u1')
    expect(focus.getUnattributedActivity).toHaveBeenCalledWith('u1')
    expect(out.mode).toBe('observe')
    expect(out.unattributed).toBe(unattributed)
    expect(out.dominions.map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(out.dominions[0]).toEqual({
      id: 'd1', name: 'VORATH', activityScore: 4.2, lastActiveAt: row.lastActiveAt,
      focusState: 'active', pinned: true, dormant: false, activity: { sessions: 3 },
    })
    expect(out.dominions[1].dormant).toBe(true)
  })

  it('reports mode off when the switch is unset', async () => {
    focus.listLiveDominions.mockResolvedValue([])
    focus.getUnattributedActivity.mockResolvedValue(null)
    expect((await getDominionFocus('u1')).mode).toBe('off')
  })
})
