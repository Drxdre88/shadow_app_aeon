import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Pure-DB layer for thinking_jobs. The DB is mocked; the assertions render
// the SQL drizzle would send, so the claim's atomicity lives in its shape.

const calls: Record<string, unknown[]> = {}
let returningRows: unknown[] = []

vi.mock('@/lib/db', () => {
  const record = (k: string, v: unknown) => { (calls[k] ??= []).push(v) }
  const chain = (prefix: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['set', 'values', 'where', 'from', 'orderBy', 'limit', 'onConflictDoNothing']) {
      c[m] = (arg: unknown) => { record(`${prefix}.${m}`, arg); return c }
    }
    c.returning = () => Promise.resolve(returningRows)
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(returningRows)
    return c
  }
  return {
    db: {
      update: vi.fn(() => chain('update')),
      insert: vi.fn(() => chain('insert')),
      select: vi.fn(() => chain('select')),
      selectDistinct: vi.fn(() => chain('select')),
    },
  }
})

import {
  FALLBACK_ERROR_PREFIX,
  claimNextJob,
  completeJob,
  expireOverdue,
  failJob,
  hasJobWithKeyLike,
  listPendingFallbacks,
  listUsersNeedingSweep,
  recordFallback,
  releaseForFallback,
  upsertJob,
} from '../thinking-jobs'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)
const USER = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'
const TOKEN = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  returningRows = []
})

describe('claimNextJob', () => {
  it('claims atomically: one UPDATE whose target is a SKIP LOCKED sub-select of the oldest live queued job', async () => {
    returningRows = [{ id: JOB, status: 'claimed' }]
    const row = await claimNextJob(USER)
    expect(row).toMatchObject({ id: JOB })

    const where = render(calls['update.where'][0])
    const text = where.sql.replace(/\s+/g, ' ')
    expect(text).toContain('"thinking_jobs"."status" = $')
    expect(text).toMatch(/"id" = \(SELECT id FROM thinking_jobs WHERE user_id = \$\d+ AND status = 'queued' AND deadline_at > now\(\) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED\)/)
    expect(where.params).toContain(USER)
    expect(where.params).toContain('queued')

    const set = calls['update.set'][0] as Record<string, unknown>
    expect(set.status).toBe('claimed')
    expect(set.claimedBy).toBe('routine')
    expect(render(set.claimToken).sql).toBe('gen_random_uuid()')
    expect(render(set.claimedAt).sql).toBe('now()')
    expect(render(set.attempts).sql).toBe('"thinking_jobs"."attempts" + 1')
  })

  it('narrows the sub-select to the requested kinds as bound params', async () => {
    await claimNextJob(USER, ['cortex', 'aether'])
    const where = render(calls['update.where'][0])
    expect(where.sql).toMatch(/AND kind IN \(\$\d+, \$\d+\) ORDER BY/)
    expect(where.params).toEqual(expect.arrayContaining(['cortex', 'aether']))
  })

  it('returns null when nothing was claimable', async () => {
    expect(await claimNextJob(USER)).toBeNull()
  })
})

describe('upsertJob', () => {
  it('inserts queued with an absolute deadline and does nothing on (user_id, external_key) conflict', async () => {
    const now = new Date('2026-10-01T02:40:00.000Z')
    const row = await upsertJob(USER, {
      kind: 'aether',
      dominionId: null,
      externalKey: 'aether:2026-10-01',
      deadlineMinutes: 33,
      input: { system: 's', prompt: 'p' },
    }, now)
    expect(row).toBeNull()
    const values = calls['insert.values'][0] as Record<string, unknown>
    expect(values).toMatchObject({ userId: USER, status: 'queued', externalKey: 'aether:2026-10-01' })
    expect((values.deadlineAt as Date).toISOString()).toBe('2026-10-01T03:13:00.000Z')
    const conflict = calls['insert.onConflictDoNothing'][0] as { target: Array<{ name: string }> }
    expect(conflict.target.map((c) => c.name)).toEqual(['user_id', 'external_key'])
  })
})

describe('completeJob / failJob / expireOverdue / recordFallback', () => {
  it('completeJob only matches the live claim (status claimed + token)', async () => {
    await completeJob(USER, JOB, TOKEN, { memoryIds: ['m'] }, 'routine')
    const where = render(calls['update.where'][0])
    expect(where.sql).toContain('"thinking_jobs"."claim_token" = $')
    expect(where.params).toEqual(expect.arrayContaining([JOB, USER, 'claimed', TOKEN]))
    expect(calls['update.set'][0]).toMatchObject({ status: 'done', claimedBy: 'routine', output: { memoryIds: ['m'] } })
  })

  it('failJob without a token fails any open job; with a token only the holder', async () => {
    await failJob(USER, JOB, null, 'boom')
    expect(render(calls['update.where'][0]).sql).not.toContain('claim_token')
    await failJob(USER, JOB, TOKEN, 'boom')
    expect(render(calls['update.where'][1]).params).toContain(TOKEN)
    expect(calls['update.set'][0]).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('expireOverdue expires queued+claimed rows past the deadline, optionally per user', async () => {
    const now = new Date('2026-10-01T04:00:00.000Z')
    await expireOverdue(now, USER)
    const where = render(calls['update.where'][0])
    expect(where.sql).toMatch(/"status" in \(\$\d+, \$\d+\)/)
    expect(where.sql).toContain('"thinking_jobs"."deadline_at" <= $')
    expect(where.params).toEqual(expect.arrayContaining(['queued', 'claimed', USER]))
    expect(calls['update.set'][0]).toMatchObject({ status: 'expired' })
  })

  it('recordFallback marks ok runs fallback and keeps declined ones expired with a reason', async () => {
    await recordFallback(USER, JOB, { ok: true, memoryIds: ['m1'] })
    expect(calls['update.set'][0]).toMatchObject({ status: 'fallback', output: { memoryIds: ['m1'] } })
    await recordFallback(USER, JOB, { ok: false, reason: 'deferred to cron' })
    expect(calls['update.set'][1]).toMatchObject({ error: 'fallback: deferred to cron' })
    expect(calls['update.set'][1]).not.toHaveProperty('status')
  })

  it('releaseForFallback moves only the live claim to expired with the reason (no completion)', async () => {
    await releaseForFallback(USER, JOB, TOKEN, 'deadline_passed: late')
    const where = render(calls['update.where'][0])
    expect(where.params).toEqual(expect.arrayContaining([JOB, USER, 'claimed', TOKEN]))
    const set = calls['update.set'][0] as Record<string, unknown>
    expect(set).toMatchObject({ status: 'expired', error: 'deadline_passed: late' })
    expect(set).not.toHaveProperty('completedAt')
  })
})

describe('pending fallbacks', () => {
  it('listPendingFallbacks: expired jobs of the given kinds whose fallback was never attempted, oldest deadline first', async () => {
    returningRows = [{ id: JOB }]
    const rows = await listPendingFallbacks(USER, ['concept'], 5)
    expect(rows).toHaveLength(1)
    const where = render(calls['select.where'][0])
    expect(where.sql).toContain('"thinking_jobs"."error" is null or "thinking_jobs"."error" not like $')
    expect(where.params).toEqual(expect.arrayContaining([USER, 'expired', 'concept', `${FALLBACK_ERROR_PREFIX}%`]))
    expect(render(calls['select.orderBy'][0]).sql).toBe('"thinking_jobs"."deadline_at" asc')
    expect(calls['select.limit'][0]).toBe(5)
  })

  it('listPendingFallbacks with no kinds does not query', async () => {
    expect(await listPendingFallbacks(USER, [])).toEqual([])
    expect(calls['select.where']).toBeUndefined()
  })

  it('listUsersNeedingSweep covers open jobs OR pending fallbacks', async () => {
    returningRows = [{ userId: USER }]
    expect(await listUsersNeedingSweep(['concept'])).toEqual([USER])
    const where = render(calls['select.where'][0])
    expect(where.sql).toMatch(/"status" in \(\$\d+, \$\d+\) or \(/)
    expect(where.params).toEqual(expect.arrayContaining(['queued', 'claimed', 'expired', 'concept']))
  })

  it('hasJobWithKeyLike matches the kind and a LIKE key pattern', async () => {
    returningRows = []
    expect(await hasJobWithKeyLike(USER, 'concept', 'concept:%:2026-W40:%')).toBe(false)
    const where = render(calls['select.where'][0])
    expect(where.sql).toContain('"thinking_jobs"."external_key" like $')
    expect(where.params).toEqual(expect.arrayContaining([USER, 'concept', 'concept:%:2026-W40:%']))
    returningRows = [{ id: JOB }]
    expect(await hasJobWithKeyLike(USER, 'concept', 'x')).toBe(true)
  })
})
