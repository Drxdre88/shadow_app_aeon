import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableName, type SQL } from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'

// Pins the activity data layer: per-user scoping of the reads, one transaction
// for every write, forward-only dates, the pinned guard and the preference
// key merge (recording drizzle stand-in, like kairos-gate.test.ts).

type Write = { kind: 'update' | 'insert'; table: string; set?: Record<string, unknown>; values?: unknown; where?: unknown; conflictSet?: Record<string, unknown>; inTx: boolean }

const h = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectWheres: [] as unknown[],
  writes: [] as Array<Record<string, unknown>>,
  inTx: false,
  failUpdate: false,
}))

vi.mock('@/lib/db', () => {
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = (w: unknown) => { h.selectWheres.push(w); return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(h.selectResults.shift() ?? [])
    return chain
  }
  const update = (table: AnyPgTable) => ({
    set: (set: Record<string, unknown>) => ({
      where: async (where: unknown) => {
        if (h.failUpdate) throw new Error('write failed')
        h.writes.push({ kind: 'update', table: getTableName(table), set, where, inTx: h.inTx })
      },
    }),
  })
  const insert = (table: AnyPgTable) => ({
    values: (values: unknown) => ({
      onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
        h.writes.push({ kind: 'insert', table: getTableName(table), values, conflictSet: cfg.set, inTx: h.inTx })
      },
    }),
  })
  const client = { select: vi.fn(select), selectDistinct: vi.fn(select), update: vi.fn(update), insert: vi.fn(insert) }
  return {
    db: {
      ...client,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        h.inTx = true
        try { return await fn(client) } finally { h.inTx = false }
      }),
    },
  }
})

import { getUnattributedActivity, listDominionActivityUserIds, scoreDominionActivityForUser } from '../dominion-activity'
import { LIVING_UNATTRIBUTED_PREF_KEY } from '@/lib/kairos/living/types'

const dialect = new PgDialect()
const render = (q: unknown) => dialect.sqlToQuery(q as SQL)
const NOW = new Date('2026-10-05T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const writes = () => h.writes as unknown as Write[]

function seedReads() {
  h.selectResults = [
    [
      { id: 'dA', createdAt: daysAgo(100), lastActiveAt: daysAgo(1), pinned: false },
      { id: 'dB', createdAt: daysAgo(100), lastActiveAt: daysAgo(40), pinned: false },
    ],
    [
      { boardId: 'b1', boardName: 'Sprint', boardDominionId: 'dA', entityType: 'task', action: 'completed', actorType: 'agent', at: daysAgo(3) },
      { boardId: 'b9', boardName: 'Loose', boardDominionId: null, entityType: 'task', action: 'created', actorType: 'user', at: NOW },
    ],
    [{ id: 'm1', kind: 'repo', ref: 'shadow_app_aeon', dominionId: 'dA', weight: 1 }],
    [{ dominionId: 'dB', repoSlug: 'shadow_app_swarm' }],
    [
      { type: 'session_summary', source: 'copilot', originKind: null, metaKind: null, repo: 'shadow_app_aeon', dominionId: 'dB', createdAt: NOW },
      { type: 'session_summary', source: 'claude', originKind: 'agent', metaKind: null, repo: 'stp_app_ermac', dominionId: null, createdAt: NOW },
      { type: 'note', source: 'manual', originKind: null, metaKind: null, repo: null, dominionId: 'dA', createdAt: NOW },
      { type: 'inbound', source: 'cron', originKind: 'kairos', metaKind: null, repo: null, dominionId: 'dB', createdAt: NOW },
    ],
  ]
}

beforeEach(() => {
  h.selectResults = []
  h.selectWheres = []
  h.writes = []
  h.failUpdate = false
  delete process.env.KAIROS_DORMANT_DAYS
})

describe('scoreDominionActivityForUser', () => {
  it('scopes every read to the user and the 30-day window', async () => {
    seedReads()
    await scoreDominionActivityForUser('u1', NOW)
    const [doms, events, members, repos, mems] = h.selectWheres.map((w) => render(w))
    expect(doms.sql).toContain('"dominions"."user_id" = $1')
    expect(doms.sql).toContain('"dominions"."archived_at" is null')
    expect(events.sql).toContain('"activity_events"."created_at" >= $1')
    expect(events.sql).toContain('"activity_events"."actor_id" = $2')
    expect(events.sql).toContain('"activity_events"."actor_id" is null and "projects"."user_id" = $3')
    expect(events.params).toEqual([daysAgo(30).toISOString(), 'u1', 'u1'])
    expect(members.sql).toContain('"dominion_members"."status" = $2')
    expect(members.params).toEqual(['u1', 'active', 'board', 'repo'])
    expect(repos.sql).toContain('"dominions"."user_id" = $1')
    expect(mems.sql).toContain('"memories"."type" = $3')
    expect(mems.sql).toContain(`'origin'->>'kind' = 'operator'`)
    expect(mems.params).toEqual(['u1', daysAgo(30).toISOString(), 'session_summary', 'manual', 'voice'])
  })

  it('writes scores, forward-only dates, guarded focus state, member signals and unattributed work in one transaction', async () => {
    seedReads()
    const run = await scoreDominionActivityForUser('u1', NOW)
    expect(run).toEqual({ userId: 'u1', scored: 2, dormant: 1, unattributedBoards: 1, unattributedRepos: 1 })
    expect(writes().every((w) => w.inTx)).toBe(true)

    const [a, b, member, pref] = writes()
    expect(a.table).toBe('dominions')
    expect(a.set!.activityScore).toBeCloseTo(3 * Math.exp(-0.3) + 2 + 0.5, 2)
    expect(a.set!.activityScoredAt).toEqual(NOW)
    expect(a.set!.activity).toMatchObject({ windowDays: 30, sessions: 1, cardsFinished: 1, notes: 1, boards: [{ id: 'b1', name: 'Sprint' }], repos: [{ slug: 'shadow_app_aeon', score: 2 }] })
    const last = render(a.set!.lastActiveAt)
    expect(last.sql).toBe('GREATEST("dominions"."last_active_at", $1::timestamp)')
    expect(last.params).toEqual([NOW.toISOString()])
    const focus = render(a.set!.focusState)
    expect(focus.sql).toBe(`CASE WHEN "dominions"."pinned" THEN 'active' ELSE $1 END`)
    expect(focus.params).toEqual(['active'])
    expect(a.set).not.toHaveProperty('pinned')
    expect(render(a.where).params).toEqual(['dA', 'u1'])

    expect(b.set!.activityScore).toBe(0)
    expect(render(b.set!.lastActiveAt).params).toEqual([daysAgo(40).toISOString()])
    expect(render(b.set!.focusState).params).toEqual(['dormant'])

    expect(member.table).toBe('dominion_members')
    expect(render(member.set!.lastSignalAt).sql).toBe('GREATEST("dominion_members"."last_signal_at", $1::timestamp)')
    expect(render(member.where).params).toEqual(['m1', 'u1'])

    expect(pref).toMatchObject({ kind: 'insert', table: 'user_preferences' })
    const unattributed = { scoredAt: NOW.toISOString(), boards: [{ id: 'b9', name: 'Loose', score: 1 }], repos: [{ slug: 'stp_app_ermac', score: 2 }] }
    expect(pref.values).toMatchObject({ userId: 'u1', preferences: { [LIVING_UNATTRIBUTED_PREF_KEY]: unattributed } })
    const merge = render(pref.conflictSet!.preferences)
    expect(merge.sql).toBe('"user_preferences"."preferences" || jsonb_build_object($1::text, $2::jsonb)')
    expect(merge.params).toEqual([LIVING_UNATTRIBUTED_PREF_KEY, JSON.stringify(unattributed)])
  })

  it('propagates a failed write so the transaction rolls back', async () => {
    seedReads()
    h.failUpdate = true
    await expect(scoreDominionActivityForUser('u1', NOW)).rejects.toThrow('write failed')
    expect(h.writes).toEqual([])
  })
})

describe('listDominionActivityUserIds', () => {
  it('lists users with a non-archived Dominion', async () => {
    h.selectResults = [[{ userId: 'u1' }, { userId: 'u2' }]]
    expect(await listDominionActivityUserIds()).toEqual(['u1', 'u2'])
    expect(render(h.selectWheres[0]).sql).toBe('"dominions"."archived_at" is null')
  })
})

describe('getUnattributedActivity', () => {
  it('returns the stored value', async () => {
    const value = { scoredAt: NOW.toISOString(), boards: [], repos: [{ slug: 'x', score: 1 }] }
    h.selectResults = [[{ value }]]
    expect(await getUnattributedActivity('u1')).toEqual(value)
    expect(render(h.selectWheres[0]).params).toEqual(['u1'])
  })

  it('returns null when missing or malformed', async () => {
    h.selectResults = [[]]
    expect(await getUnattributedActivity('u1')).toBeNull()
    h.selectResults = [[{ value: null }]]
    expect(await getUnattributedActivity('u1')).toBeNull()
    h.selectResults = [[{ value: { boards: 'nope' } }]]
    expect(await getUnattributedActivity('u1')).toBeNull()
  })
})
