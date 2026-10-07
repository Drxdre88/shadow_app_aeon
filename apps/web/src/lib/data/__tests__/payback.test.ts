import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Payback ledger: unknown cost stays unknown, runner deaths are their own
// bucket, internal Kairos threads never count, the period filters on spawn time.

const selectRows: unknown[][] = []
let lastWhere: unknown = null

vi.mock('@/lib/db', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = (arg: unknown) => { lastWhere = arg; return c }
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(selectRows.shift() ?? [])
    return c
  }
  return { db: { select: vi.fn(() => chain()) } }
})
vi.mock('../projects', () => ({ verifyProjectAccess: vi.fn(async () => ({ role: 'viewer' })) }))

import { readAgentPayback, summarisePayback, paybackSince, PaybackAccessError, type PaybackRow } from '../payback'
import { verifyProjectAccess } from '../projects'
import { db } from '@/lib/db'
import { renderPaybackMarkdown } from '@/lib/kairos/payback/render'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const compile = (value: unknown) => new PgDialect().sqlToQuery(value as SQL)

let seq = 0
function row(over: Partial<PaybackRow> = {}): PaybackRow {
  seq++
  return {
    sessionId: `s${seq}`,
    taskId: `t${seq}`,
    engine: 'claude',
    repo: 'aeon',
    status: 'succeeded',
    costUsd: '1.0000',
    startedAt: new Date('2026-10-06T10:00:00Z'),
    endedAt: new Date('2026-10-06T10:30:00Z'),
    model: null,
    cardName: `Card ${seq}`,
    boardName: 'Board',
    ...over,
  }
}

const summarise = (rows: PaybackRow[]) => summarisePayback(rows, { period: '30d', since: null })

beforeEach(() => {
  vi.clearAllMocks()
  selectRows.length = 0
  lastWhere = null
})

describe('summarisePayback', () => {
  it('counts a null cost as unknown, never as zero', () => {
    const view = summarise([row({ costUsd: '2.5000' }), row({ costUsd: null }), row({ costUsd: null, status: 'failed' })])
    expect(view.totals.costKnownUsd).toBe(2.5)
    expect(view.totals.missionsWithUnknownCost).toBe(2)
    expect(view.totals.costPerSucceeded).toBe(2.5)
  })

  it('reports cost per finished mission as null when no finished mission has a cost', () => {
    const view = summarise([row({ costUsd: null }), row({ status: 'failed', costUsd: '3' })])
    expect(view.totals.costPerSucceeded).toBeNull()
    expect(view.totals.costKnownUsd).toBe(3)
  })

  it('divides all known spend, failures included, by finished missions with a cost', () => {
    const view = summarise([row({ costUsd: '2' }), row({ status: 'failed', costUsd: '4' })])
    expect(view.totals.costPerSucceeded).toBe(6)
  })

  it('puts timeout and killed missions in their own runner-died bucket, not failed', () => {
    const view = summarise([row({ status: 'timeout' }), row({ status: 'killed' }), row({ status: 'failed' }), row({ status: 'running' }), row({ status: 'queued' })])
    expect(view.totals).toMatchObject({ missions: 5, failed: 1, runnerDied: 2, ownerStopped: 0, running: 1, queued: 1, succeeded: 0 })
  })

  it('counts a kill the owner asked for as stopped by you, not a runner death', () => {
    const view = summarise([row({ status: 'killed', killedBy: 'owner' }), row({ status: 'killed', killedBy: null }), row({ status: 'timeout', killedBy: 'owner' })])
    expect(view.totals).toMatchObject({ missions: 3, ownerStopped: 1, runnerDied: 2, failed: 0 })
    expect(view.breakdowns.engine?.[0]).toMatchObject({ ownerStopped: 1, runnerDied: 2 })
  })

  it('drops internal Kairos engines and card-less sessions', () => {
    const view = summarise([row(), row({ engine: 'kairos-chat' }), row({ engine: 'kairos-dialogue' }), row({ engine: 'kairos-today' }), row({ taskId: null })])
    expect(view.totals.missions).toBe(1)
    expect(view.breakdowns.engine?.map((b) => b.key)).toEqual(['claude'])
  })

  it("groups an unset model under 'default'", () => {
    const view = summarise([row({ model: null }), row({ model: 'opus' }), row({ model: null })])
    expect(view.breakdowns.model).toEqual([
      expect.objectContaining({ key: 'default', missions: 2 }),
      expect.objectContaining({ key: 'opus', missions: 1 }),
    ])
  })

  it('sums duration only where both start and end are set', () => {
    const view = summarise([row(), row({ endedAt: null, status: 'running' })])
    expect(view.totals.totalDurationMin).toBe(30)
  })

  it('ranks top cards by known cost and caps at ten', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ costUsd: String(i + 1) }))
    rows.push(row({ taskId: rows[0].taskId, costUsd: '100' }), row({ costUsd: null }))
    const view = summarise(rows)
    expect(view.topCards).toHaveLength(10)
    expect(view.topCards[0]).toMatchObject({ taskId: rows[0].taskId, costKnownUsd: 101, missions: 2 })
    expect(view.topCards[1]).toMatchObject({ costKnownUsd: 12, missions: 1 })
    expect(view.topCards.every((c) => c.costKnownUsd > 0)).toBe(true)
  })

  it('limits breakdowns to groupBy when given', () => {
    const view = summarisePayback([row()], { period: '7d', since: null, groupBy: 'repo' })
    expect(Object.keys(view.breakdowns)).toEqual(['repo'])
  })
})

describe('readAgentPayback', () => {
  it('filters on user, missions only, internal engines and the period start', async () => {
    selectRows.push([row(), row({ engine: 'kairos-chat' })])
    const view = await readAgentPayback('user-1', { period: '7d' }, NOW)
    const select = vi.mocked(db.select).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(compile(select.killedBy).sql).toBe(`"agent_sessions"."metadata" -> 'kill' ->> 'by'`)
    const { sql, params } = compile(lastWhere)
    expect(sql).toContain('"task_id" is not null')
    expect(sql).toMatch(/"engine" not in/)
    expect(params).toEqual(expect.arrayContaining(['user-1', 'kairos-chat', 'kairos-dialogue', 'kairos-today']))
    expect(sql).toMatch(/"spawned_at" >=/)
    expect(params).toContain(paybackSince('7d', NOW)!.toISOString())
    expect(view.since).toBe('2026-09-29T12:00:00.000Z')
    expect(view.totals.missions).toBe(1)
  })

  it("has no period filter for 'all'", async () => {
    await readAgentPayback('user-1', { period: 'all' }, NOW)
    expect(compile(lastWhere).sql).not.toMatch(/spawned_at/)
    expect(verifyProjectAccess).not.toHaveBeenCalled()
  })

  it('checks project access and scopes to the project', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    await readAgentPayback('user-1', { period: '30d', projectId }, NOW)
    expect(verifyProjectAccess).toHaveBeenCalledWith(projectId, 'user-1')
    expect(compile(lastWhere).params).toContain(projectId)
  })

  it('refuses a project the user cannot see', async () => {
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce(null)
    await expect(readAgentPayback('user-1', { period: '30d', projectId: 'p' }, NOW)).rejects.toBeInstanceOf(PaybackAccessError)
  })
})

describe('renderPaybackMarkdown', () => {
  it('writes the plain-English headline', () => {
    const view = summarise([row({ costUsd: '12.4' }), row({ status: 'failed', costUsd: null }), row({ status: 'timeout', costUsd: null })])
    const md = renderPaybackMarkdown(view)
    expect(md).toContain('30 days: 3 missions, 1 finished, 1 failed, 1 stopped because the runner died.')
    expect(md).toContain('Known cost $12.40 across 1 mission; 2 had no cost recorded.')
  })

  it('says how many missions the owner stopped, in the headline and the breakdown', () => {
    const md = renderPaybackMarkdown(summarise([row(), row({ status: 'killed', killedBy: 'owner', costUsd: null }), row({ status: 'killed', costUsd: null })]))
    expect(md).toContain('30 days: 3 missions, 1 finished, 0 failed, 1 stopped because the runner died, 1 stopped by you.')
    expect(md).toContain('1 runner died, 1 stopped by you)')
  })

  it('says so when there are no missions', () => {
    expect(renderPaybackMarkdown(summarise([]))).toContain('30 days: no Hangar missions.')
  })
})
