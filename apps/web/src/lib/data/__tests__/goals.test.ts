import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Goal data layer (Phase 2, Track A): SQL shape only, no real DB. Locks the
// advisory lock, the compare-and-set guard, the origin.via scope on every
// read, the 72h / dueAt+7d stale filters and the proposal row shape.

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  selectQueue: [] as unknown[][],
  insertQueue: [] as unknown[][],
  updateQueue: [] as unknown[][],
}))

vi.mock('@/lib/db', () => {
  function handle(via: 'db' | 'tx') {
    return {
      execute: async (arg: unknown) => {
        state.calls.push({ via, kind: 'execute', arg })
      },
      select: (cols: unknown) => {
        const call: Record<string, unknown> = { via, kind: 'select', cols }
        state.calls.push(call)
        const chain: Record<string, unknown> = {}
        chain.from = () => chain
        chain.where = (w: unknown) => {
          call.where = w
          return chain
        }
        chain.orderBy = (...args: unknown[]) => {
          call.orderBy = args
          return chain
        }
        chain.limit = (n: number) => {
          call.limit = n
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
          const call: Record<string, unknown> = { via, kind: 'update', arg }
          state.calls.push(call)
          return {
            where: (w: unknown) => {
              call.where = w
              return { returning: async () => state.updateQueue.shift() ?? [] }
            },
          }
        },
      }),
    }
  }
  return {
    db: {
      ...handle('db'),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(handle('tx'))),
    },
  }
})

import {
  casGoalUpdate,
  countOpenGoals,
  goalStats,
  insertGoalProposal,
  listGoalSimilarities,
  listStaleGoals,
  summariseGoalStats,
  withGoalLock,
  type GoalRecord,
} from '../goals'
import type { GoalMeta } from '@/lib/kairos/goals/parse'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)
const USER = 'user-1'
const NOW = new Date('2026-10-02T04:00:00.000Z')

const meta = (over: Partial<GoalMeta> = {}): GoalMeta => ({
  v: 1,
  state: 'proposed',
  kind: 'investigation',
  question: 'What blocks go-live?',
  why: 'Seeded by an idea.',
  successCheck: { type: 'owner_confirm', text: 'You agree.' },
  dueInDays: 7,
  dueAt: null,
  seeds: [{ kind: 'idea', id: 'seed-1' }],
  proposedOn: '2026-10-02',
  proposedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
  jobId: 'job-1',
  answeredBy: 'routine',
  decidedAt: null,
  decidedVia: null,
  vetoNote: null,
  closedAt: null,
  closedBy: null,
  closeNote: null,
  telegram: null,
  history: [],
  ...over,
})

const lastOf = (kind: string) => [...state.calls].reverse().find((c) => c.kind === kind) as Record<string, unknown>

beforeEach(() => {
  state.calls = []
  state.selectQueue = []
  state.insertQueue = []
  state.updateQueue = []
})

describe('withGoalLock', () => {
  it('takes the per-user advisory lock inside the transaction before running', async () => {
    const seen: string[] = []
    await withGoalLock(USER, async () => {
      seen.push('fn')
    })
    const lock = render(state.calls[0].arg)
    expect(state.calls[0]).toMatchObject({ via: 'tx', kind: 'execute' })
    expect(lock.sql).toContain('pg_advisory_xact_lock(hashtext($1), hashtext($2))')
    expect(lock.params).toEqual([USER, 'kairos_goals'])
    expect(seen).toEqual(['fn'])
  })
})

describe('casGoalUpdate', () => {
  it('guards on the from-state and the goal_propose origin, merges the goal patch, retypes and stamps status', async () => {
    state.updateQueue.push([])
    const res = await casGoalUpdate(USER, 'g-1', 'proposed', { goal: { state: 'active' }, status: 'accepted', type: 'kairos_goal' }, NOW)
    expect(res).toBeNull()
    const call = lastOf('update')
    const where = render(call.where)
    expect(where.sql).toContain(`"memories"."source_metadata"->'goal'->>$`)
    expect(where.params).toEqual(expect.arrayContaining(['g-1', USER, 'state', 'proposed', 'thinking:goal_propose']))
    expect(where.sql).toContain(`"memories"."source_metadata"->'origin'->>'via' = $`)
    const set = call.arg as Record<string, unknown>
    const merge = render(set.sourceMetadata)
    expect(merge.sql).toContain(`jsonb_set("memories"."source_metadata" || $1::jsonb, '{goal}', ("memories"."source_metadata"->'goal') || $2::jsonb)`)
    expect(merge.params).toEqual([JSON.stringify({ status: 'accepted' }), JSON.stringify({ state: 'active' })])
    expect(set.type).toBe('kairos_goal')
    expect(set).not.toHaveProperty('archivedAt')
  })

  it('archives when asked and returns the moved row', async () => {
    state.updateQueue.push([{ id: 'g-1', title: 'T', type: 'inbound', dominionId: null, archivedAt: NOW, createdAt: NOW, sourceMetadata: { goal: meta({ state: 'vetoed' }) } }])
    const res = await casGoalUpdate(USER, 'g-1', 'proposed', { goal: { state: 'vetoed' }, archive: true }, NOW)
    expect(res?.meta.state).toBe('vetoed')
    expect((lastOf('update').arg as Record<string, unknown>).archivedAt).toBe(NOW)
  })
})

describe('reads are scoped to goal_propose rows', () => {
  it('countOpenGoals counts active and unexpired, unarchived proposals', async () => {
    state.selectQueue.push([{ active: 1, pending: 1 }])
    await expect(countOpenGoals(USER, NOW)).resolves.toEqual({ active: 1, pending: 1 })
    const call = lastOf('select')
    const where = render(call.where)
    expect(where.sql).toContain('"memories"."archived_at" is null')
    expect(where.params).toContain('thinking:goal_propose')
    const pending = render((call.cols as Record<string, unknown>).pending)
    expect(pending.sql).toContain('::timestamptz >')
    expect(pending.params).toContain(NOW.toISOString())
  })

  it('listStaleGoals selects proposals past expiry and active goals past dueAt + 7 days', async () => {
    await listStaleGoals(USER, NOW)
    const where = render(lastOf('select').where)
    expect(where.sql).toContain(`= 'proposed' and`)
    expect(where.sql).toContain(`= 'active' and`)
    expect(where.params).toEqual(expect.arrayContaining(['expiresAt', 'dueAt', NOW.toISOString(), new Date(NOW.getTime() - 7 * 86_400_000).toISOString()]))
  })

  it('listGoalSimilarities scans active, pending and 30-day vetoed goals without a distance ORDER BY', async () => {
    state.selectQueue.push([{ id: 'g-1', state: 'active', similarity: '0.9' }, { id: 'g-2', state: 'vetoed', similarity: 'NaN' }])
    await expect(listGoalSimilarities(USER, [0.1, 0.2], NOW)).resolves.toEqual([{ id: 'g-1', state: 'active', similarity: 0.9 }])
    const call = lastOf('select')
    const where = render(call.where)
    expect(where.sql).toContain(`= 'vetoed' and`)
    expect(where.params).toContain(new Date(NOW.getTime() - 30 * 86_400_000).toISOString())
    expect((call.orderBy as unknown[]).map((o) => render(o).sql)).toEqual(['"memories"."created_at" desc'])
  })
})

describe('insertGoalProposal', () => {
  it('writes a pending inbound goal proposal with kairos origin and no introspection flag', async () => {
    state.insertQueue.push([{ id: 'g-new' }])
    const m = meta()
    const id = await insertGoalProposal(USER, {
      title: 'Why the desk stalls',
      bodyMd: 'body',
      summary: m.question,
      dominionId: null,
      meta: m,
      citations: ['seed-1', 'seed-1'],
      embedding: null,
      now: NOW,
    })
    expect(id).toBe('g-new')
    const values = lastOf('insert').arg as Record<string, unknown>
    expect(values).toMatchObject({ userId: USER, type: 'inbound', streamClass: 'agentic', source: 'cron', tags: ['proposal', 'goal'] })
    expect(values.sourceMetadata).toEqual({
      kind: 'goal',
      status: 'pending',
      expiresAt: m.expiresAt,
      citations: ['seed-1'],
      goal: m,
      origin: { kind: 'kairos', via: 'thinking:goal_propose' },
    })
    expect(values).not.toHaveProperty('embedding')
  })
})

describe('goal stats', () => {
  const rec = (m: Partial<GoalMeta>): GoalRecord => ({ id: 'x', title: 't', type: 'inbound', dominionId: null, archivedAt: null, createdAt: NOW, meta: meta(m) })
  const decided = (mins: number) => new Date(NOW.getTime() + mins * 60_000).toISOString()

  it('computes acceptance, done-and-checked and median decision minutes', () => {
    const stats = summariseGoalStats([
      rec({ state: 'done', decidedAt: decided(10) }),
      rec({ state: 'failed', decidedAt: decided(30) }),
      rec({ state: 'vetoed', decidedAt: decided(60) }),
      rec({ state: 'expired' }),
      rec({ state: 'proposed' }),
      rec({ state: 'active', decidedAt: decided(20) }),
    ])
    expect(stats).toMatchObject({ proposed: 6, approved: 3, vetoed: 1, expired: 1, pending: 1, active: 1, done: 1, failed: 1 })
    expect(stats.acceptanceRate).toBeCloseTo(3 / 5)
    expect(stats.doneCheckedRate).toBeCloseTo(1 / 2)
    expect(stats.medianDecisionMinutes).toBe(25)
  })

  it('is null-rated before any decision', () => {
    expect(summariseGoalStats([])).toMatchObject({ acceptanceRate: null, doneCheckedRate: null, medianDecisionMinutes: null })
  })

  it('goalStats reads goals created in the window', async () => {
    await goalStats(USER, 14, NOW)
    const where = render(lastOf('select').where)
    expect(where.params).toEqual(expect.arrayContaining([USER, 'thinking:goal_propose', new Date(NOW.getTime() - 14 * 86_400_000).toISOString()]))
  })
})
