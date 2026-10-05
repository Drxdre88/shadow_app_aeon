import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Stall reconciler: a silent running mission is settled as 'timeout' and its
// card sent to Tower; a long-unclaimed queued mission stays queued but is
// flagged "runner offline". Both re-check state inside the write.

type Capture = { op: string; where?: unknown; set?: Record<string, unknown> }

const selectQueue: unknown[][] = []
const updateQueue: unknown[][] = []
const captures: Capture[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function chain(op: string, rows: () => unknown[]) {
    const capture: Capture = { op }
    captures.push(capture)
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.from = pass
    c.orderBy = pass
    c.limit = pass
    c.set = (arg: Record<string, unknown>) => { capture.set = arg; return c }
    c.where = (arg: unknown) => { capture.where = arg; return c }
    c.returning = () => Promise.resolve(rows())
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return c
  }
  const makeDb = () => ({
    select: vi.fn(() => chain('select', () => selectQueue.shift() ?? [])),
    update: vi.fn(() => chain('update', () => updateQueue.shift() ?? [])),
  })
  return {
    db: {
      ...makeDb(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalls++
        return fn(makeDb())
      }),
    },
  }
})

vi.mock('../sessions', () => ({
  resolveResultColumn: vi.fn(async () => 'tower-col'),
  getNextEventSeq: vi.fn(async () => 7),
  recordSessionEventWithAutoSeq: vi.fn(async () => ({ id: 'ev' })),
}))
vi.mock('../projects', () => ({ touchProject: vi.fn(async () => {}) }))

import { reconcileHangarSessions, staleThresholdMinutes, timeoutReason } from '../hangar-reconcile'
import { recordSessionEventWithAutoSeq, resolveResultColumn } from '../sessions'
import { touchProject } from '../projects'

const dialect = new PgDialect()
const compile = (value: unknown) => dialect.sqlToQuery(value as SQL)
const NOW = new Date('2026-10-05T12:00:00.000Z')
const updates = () => captures.filter((c) => c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateQueue.length = 0
  captures.length = 0
  transactionCalls = 0
})

describe('staleThresholdMinutes', () => {
  it('reads KAIROS_HANGAR_STALE_MIN and falls back to 30', () => {
    expect(staleThresholdMinutes({})).toBe(30)
    expect(staleThresholdMinutes({ KAIROS_HANGAR_STALE_MIN: '45' })).toBe(45)
    expect(staleThresholdMinutes({ KAIROS_HANGAR_STALE_MIN: 'soon' })).toBe(30)
    expect(staleThresholdMinutes({ KAIROS_HANGAR_STALE_MIN: '-5' })).toBe(30)
  })
})

describe('reconcileHangarSessions', () => {
  it('times out a silent running mission and moves its card to Tower with the reason', async () => {
    selectQueue.push([{ id: 's-run', taskId: 't-1' }]) // stale running scan
    selectQueue.push([{ id: 't-1', projectId: 'p-1' }]) // card lookup
    selectQueue.push([]) // queued scan
    updateQueue.push([{ id: 's-run' }], [])

    const report = await reconcileHangarSessions({ minutes: 30, now: NOW })

    expect(report).toEqual({ thresholdMinutes: 30, timedOut: ['s-run'], flaggedOffline: [], failed: [] })
    expect(transactionCalls).toBe(1)
    expect(resolveResultColumn).toHaveBeenCalledWith('p-1', 'needs_input')

    const scan = compile(captures[0].where)
    expect(scan.sql).toContain('"status" = $1')
    expect(scan.params).toContain('running')
    expect(scan.sql).toContain('session_events')
    expect(scan.params).toContain('2026-10-05T11:30:00.000Z')

    const [sessionFlip, cardPatch] = updates()
    expect(sessionFlip.set).toMatchObject({ status: 'timeout', endedAt: NOW })
    const flipGuard = compile(sessionFlip.where)
    expect(flipGuard.params).toContain('running')
    expect(cardPatch.set).toMatchObject({ columnId: 'tower-col' })
    const cardSql = compile(cardPatch.set?.metadata)
    expect(cardSql.sql).toContain('{hangar,lastResult}')
    expect(cardSql.sql).toContain('{hangar,stall}')
    expect(cardSql.params.join(' ')).toContain(timeoutReason(30))

    expect(touchProject).toHaveBeenCalledWith('p-1', { type: 'task:updated' })
    expect(recordSessionEventWithAutoSeq).toHaveBeenCalledWith('s-run', expect.objectContaining({
      seq: 7,
      kind: 'system',
      payload: { subtype: 'timeout', message: timeoutReason(30) },
    }))
  })

  it('leaves a mission alone when a heartbeat or result landed after the scan', async () => {
    selectQueue.push([{ id: 's-run', taskId: 't-1' }], [{ id: 't-1', projectId: 'p-1' }], [])
    updateQueue.push([])

    const report = await reconcileHangarSessions({ minutes: 30, now: NOW })

    expect(report.timedOut).toEqual([])
    expect(updates()).toHaveLength(1)
    expect(touchProject).not.toHaveBeenCalled()
    expect(recordSessionEventWithAutoSeq).not.toHaveBeenCalled()
  })

  it('flags a long-unclaimed queued mission as runner offline without changing its status', async () => {
    selectQueue.push([]) // running scan
    selectQueue.push([{ id: 's-q', taskId: 't-2' }]) // queued scan
    selectQueue.push([{ id: 't-2', projectId: 'p-2' }])
    updateQueue.push([{ id: 's-q' }], [])

    const report = await reconcileHangarSessions({ minutes: 20, now: NOW })

    expect(report.flaggedOffline).toEqual(['s-q'])
    expect(report.timedOut).toEqual([])
    const queuedScan = compile(captures[1].where)
    expect(queuedScan.params).toContain('queued')
    expect(queuedScan.sql).toContain("-> 'reconcile'")

    const [sessionPatch, cardPatch] = updates()
    expect(sessionPatch.set).not.toHaveProperty('status')
    expect(compile(sessionPatch.set?.metadata).params.join(' ')).toContain('runner_offline')
    expect(cardPatch.set).not.toHaveProperty('columnId')
    expect(compile(cardPatch.set?.metadata).sql).toContain('{hangar,stall}')
    expect(touchProject).toHaveBeenCalledWith('p-2', { type: 'task:updated' })
  })

  it('isolates a failing row and keeps reconciling the rest', async () => {
    selectQueue.push([{ id: 's-bad', taskId: 't-1' }, { id: 's-ok', taskId: null }])
    selectQueue.push([{ id: 't-1', projectId: 'p-1' }])
    selectQueue.push([])
    vi.mocked(resolveResultColumn).mockRejectedValueOnce(new Error('neon blip'))
    updateQueue.push([{ id: 's-ok' }])

    const report = await reconcileHangarSessions({ minutes: 30, now: NOW })

    expect(report.failed).toEqual([{ sessionId: 's-bad', error: 'neon blip' }])
    expect(report.timedOut).toEqual(['s-ok'])
  })
})
