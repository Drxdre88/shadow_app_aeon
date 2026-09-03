import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  DEFAULT_HOURS_PER_POINT,
  groupAssignments,
  priorityRank,
  resolveOwnerResourceId,
  sizingFromSettings,
  solveWindowFor,
  toScheduleDependencies,
  toScheduleTask,
  toTaskStatus,
  type AdapterContext,
  type AssignmentRow,
  type ScheduleTaskRow,
} from '../adapter'
import { UNESTIMATED_DEFAULT_MINUTES } from '../types'
import { solve } from '../solver'
import { buildCalendarIndex } from '../calendar'
import { LONDON_MON_FRI, RESOURCE_SOLO, task as engineTask } from '../fixtures'

const DAY_MS = 86_400_000
const NOW = new Date('2026-09-07T09:00:00.000Z')

function row(over: Partial<ScheduleTaskRow> = {}): ScheduleTaskRow {
  return {
    id: 't1',
    status: 'todo',
    priority: 'medium',
    columnId: 'col-a',
    startDate: null,
    endDate: null,
    size: null,
    progress: null,
    orderIndex: 0,
    completedAt: null,
    estimateMinutes: null,
    scheduleMode: 'auto',
    constraintType: 'asap',
    constraintDate: null,
    isMilestone: false,
    ownerResourceId: null,
    startedAt: null,
    ...over,
  }
}

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sizing: { unit: 'days', hoursPerPoint: DEFAULT_HOURS_PER_POINT },
    columnOrder: new Map([['col-a', 0], ['col-b', 1]]),
    assignments: new Map(),
    resourceIdByUserId: new Map([['u1', 'r-u1'], ['u2', 'r-u2']]),
    resourceIdByVirtualMemberId: new Map([['v1', 'r-v1']]),
    hoursPerDayByResourceId: new Map([['r-u1', 8], ['r-u2', 6]]),
    defaultHoursPerDay: 8,
    ...over,
  }
}

function assigned(taskId: string, who: { userId?: string; virtualMemberId?: string }, minute: number): AssignmentRow {
  return { taskId, userId: who.userId ?? null, virtualMemberId: who.virtualMemberId ?? null, assignedAt: new Date(NOW.getTime() + minute * 60_000) }
}

describe('sizing reconciliation', () => {
  it('defaults to days with 8h/point when the board has no sizing block', () => {
    expect(sizingFromSettings(null)).toEqual({ unit: 'days', hoursPerPoint: 8 })
    expect(sizingFromSettings({})).toEqual({ unit: 'days', hoursPerPoint: 8 })
  })

  it('reads a points board and its hoursPerPoint override', () => {
    expect(sizingFromSettings({ sizing: { unit: 'points' } })).toEqual({ unit: 'points', hoursPerPoint: 8 })
    expect(sizingFromSettings({ sizing: { unit: 'points', hoursPerPoint: 6 } })).toEqual({ unit: 'points', hoursPerPoint: 6 })
    expect(sizingFromSettings({ sizing: { unit: 'points', hoursPerPoint: -3 } })).toEqual({ unit: 'points', hoursPerPoint: 8 })
    expect(sizingFromSettings({ sizing: { unit: 'weeks' } }).unit).toBe('days')
  })

  it('converts a day-sized card through the OWNER calendar hours, not the default', () => {
    const owned = toScheduleTask(row({ size: 2, ownerResourceId: 'r-u2' }), ctx())
    expect(owned.estimateMinutes).toBe(2 * 6 * 60)
    const unowned = toScheduleTask(row({ size: 2 }), ctx())
    expect(unowned.estimateMinutes).toBe(2 * 8 * 60)
  })

  it('converts a points card through hoursPerPoint and lets explicit minutes win', () => {
    const points = toScheduleTask(row({ size: 3 }), ctx({ sizing: { unit: 'points', hoursPerPoint: 5 } }))
    expect(points.estimateMinutes).toBe(3 * 5 * 60)
    const explicit = toScheduleTask(row({ size: 3, estimateMinutes: 90 }), ctx())
    expect(explicit.estimateMinutes).toBe(90)
  })

  it('leaves an unsized, unestimated card null so the engine applies its default span', () => {
    expect(toScheduleTask(row(), ctx()).estimateMinutes).toBeNull()
    expect(UNESTIMATED_DEFAULT_MINUTES).toBe(480)
  })
})

describe('status, mode and ordering', () => {
  it('maps the three board statuses and treats anything else as todo', () => {
    expect(toTaskStatus('done')).toBe('done')
    expect(toTaskStatus('in-progress')).toBe('in-progress')
    expect(toTaskStatus('todo')).toBe('todo')
    expect(toTaskStatus('blocked')).toBe('todo')
  })

  it('ranks priority urgent first and unknown as medium', () => {
    expect([priorityRank('urgent'), priorityRank('high'), priorityRank('medium'), priorityRank('low')]).toEqual([0, 1, 2, 3])
    expect(priorityRank('???')).toBe(2)
  })

  it('carries column order and sorts column-less cards last', () => {
    expect(toScheduleTask(row({ columnId: 'col-b' }), ctx()).columnOrder).toBe(1)
    expect(toScheduleTask(row({ columnId: null }), ctx()).columnOrder).toBe(Number.MAX_SAFE_INTEGER)
    expect(toScheduleTask(row({ columnId: 'gone' }), ctx()).columnOrder).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('carries the typed dates as plannedStart / plannedEnd and unknown modes as auto/asap', () => {
    const start = new Date('2026-09-09T09:00:00.000Z')
    const end = new Date('2026-09-10T09:00:00.000Z')
    const t = toScheduleTask(row({ startDate: start, endDate: end, scheduleMode: 'pinned', constraintType: 'must' }), ctx())
    expect(t.plannedStart).toBe(start)
    expect(t.plannedEnd).toBe(end)
    expect(t.scheduleMode).toBe('auto')
    expect(t.constraintType).toBe('asap')
    expect(toScheduleTask(row({ scheduleMode: 'manual', constraintType: 'fnlt' }), ctx()).scheduleMode).toBe('manual')
    expect(toScheduleTask(row({ constraintType: 'snet' }), ctx()).constraintType).toBe('snet')
  })
})

describe('owner derivation', () => {
  it('an explicit owner_resource_id wins over every assignee', () => {
    const assignments = groupAssignments([assigned('t1', { userId: 'u1' }, 0)])
    expect(resolveOwnerResourceId(row({ ownerResourceId: 'r-v1' }), ctx({ assignments }))).toBe('r-v1')
  })

  it('the earliest assignment owns the card, real or virtual', () => {
    const assignments = groupAssignments([
      assigned('t1', { userId: 'u1' }, 5),
      assigned('t1', { virtualMemberId: 'v1' }, 1),
    ])
    expect(resolveOwnerResourceId(row(), ctx({ assignments }))).toBe('r-v1')
  })

  it('skips an assignee with no resource and falls through to the next', () => {
    const assignments = groupAssignments([
      assigned('t1', { userId: 'ghost' }, 0),
      assigned('t1', { userId: 'u2' }, 1),
    ])
    expect(resolveOwnerResourceId(row(), ctx({ assignments }))).toBe('r-u2')
    expect(resolveOwnerResourceId(row(), ctx({ assignments: groupAssignments([assigned('t1', { userId: 'ghost' }, 0)]) }))).toBeNull()
    expect(resolveOwnerResourceId(row(), ctx())).toBeNull()
  })

  it('breaks an assignedAt tie deterministically by identity', () => {
    const assignments = groupAssignments([
      assigned('t1', { userId: 'u2' }, 0),
      assigned('t1', { userId: 'u1' }, 0),
    ])
    expect(resolveOwnerResourceId(row(), ctx({ assignments }))).toBe('r-u1')
  })

  it('a pin to a resource this project does not know falls through to the assignees', () => {
    const assignments = groupAssignments([assigned('t1', { userId: 'u2' }, 0)])
    expect(resolveOwnerResourceId(row({ ownerResourceId: 'r-other-project' }), ctx({ assignments }))).toBe('r-u2')
    expect(resolveOwnerResourceId(row({ ownerResourceId: 'r-other-project' }), ctx())).toBeNull()
  })

  it('a pin to a person-less resource (agent) still wins when it is in the hours map', () => {
    const hoursPerDayByResourceId = new Map([['r-agent', 24]])
    expect(resolveOwnerResourceId(row({ ownerResourceId: 'r-agent' }), ctx({ hoursPerDayByResourceId }))).toBe('r-agent')
  })
})

describe('dependencies and window', () => {
  it('maps every task_dependencies row to a zero-lag finish-to-start edge', () => {
    expect(toScheduleDependencies([{ blockerTaskId: 'a', blockedTaskId: 'b' }])).toEqual([
      { blockerTaskId: 'a', blockedTaskId: 'b', type: 'fs', lagMinutes: 0 },
    ])
  })

  test.prop(
    [fc.array(fc.integer({ min: -400, max: 400 }), { maxLength: 12 })],
    { numRuns: 60 },
  )('the solve window covers now and every actual, typed and constraint date with headroom', (offsets) => {
    const tasks = offsets.map((offset, i) => {
      const d = new Date(NOW.getTime() + offset * DAY_MS)
      const slot = i % 5
      return toScheduleTask(
        row({
          id: `t${i}`,
          startedAt: slot === 0 ? d : null,
          completedAt: slot === 1 ? d : null,
          startDate: slot === 2 ? d : null,
          endDate: slot === 3 ? d : null,
          constraintDate: slot === 4 ? d : null,
        }),
        ctx(),
      )
    })
    const window = solveWindowFor(tasks, NOW)
    expect(window.start.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(window.end.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 60 * DAY_MS)
    for (const offset of offsets) {
      const ms = NOW.getTime() + offset * DAY_MS
      expect(window.start.getTime()).toBeLessThanOrEqual(ms)
      expect(window.end.getTime()).toBeGreaterThanOrEqual(ms + 60 * DAY_MS)
    }
  })
})

describe('window bounds', () => {
  const MAX_LOOKBACK_MS = 2 * 365 * DAY_MS
  const MAX_WINDOW_MS = (40 * 366 - 60) * DAY_MS

  it('floors the backward reach at two years and keeps now inside the span', () => {
    const ancient = toScheduleTask(row({ startDate: new Date('1970-01-01T00:00:00.000Z') }), ctx())
    const window = solveWindowFor([ancient], NOW)
    expect(window.start.getTime()).toBe(NOW.getTime() - MAX_LOOKBACK_MS)
    expect(window.end.getTime()).toBe(NOW.getTime() + 60 * DAY_MS)
  })

  it('caps the whole span below the index ceiling so a far-future date cannot push now out', () => {
    const distant = toScheduleTask(row({ endDate: new Date('2999-12-31T00:00:00.000Z') }), ctx())
    const window = solveWindowFor([distant], NOW)
    expect(window.start.getTime()).toBe(NOW.getTime())
    expect(window.end.getTime()).toBe(NOW.getTime() + MAX_WINDOW_MS)
  })

  test.prop([fc.array(fc.date({ noInvalidDate: true }), { maxLength: 8 })], { numRuns: 100 })(
    'for any dates at all, now sits strictly inside the window and the span stays under the cap',
    (dates) => {
      const tasks = dates.map((d, i) => toScheduleTask(row({ id: `t${i}`, startDate: i % 2 === 0 ? d : null, endDate: i % 2 === 1 ? d : null }), ctx()))
      const window = solveWindowFor(tasks, NOW)
      expect(window.start.getTime()).toBeLessThanOrEqual(NOW.getTime())
      expect(window.start.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - MAX_LOOKBACK_MS)
      expect(window.end.getTime()).toBeGreaterThan(NOW.getTime())
      expect(window.end.getTime() - window.start.getTime()).toBeLessThanOrEqual(MAX_WINDOW_MS)
    },
  )

  it('regression: one card dated 1970 no longer clamps every placement to a decade-old index edge', () => {
    const tasks = [
      engineTask('ancient', { plannedStart: new Date('1970-01-01T00:00:00.000Z') }),
      engineTask('fresh'),
    ]
    const window = solveWindowFor(tasks, NOW)
    const result = solve(
      { tasks, dependencies: [], resources: [RESOURCE_SOLO], calendars: [LONDON_MON_FRI], now: NOW, defaultCalendarId: LONDON_MON_FRI.id },
      (calendar) => buildCalendarIndex(calendar, window),
    )
    expect(result.placements).toHaveLength(2)
    for (const p of result.placements) {
      expect(p.computedStart.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
      expect(p.computedEnd.getTime()).toBeGreaterThan(p.computedStart.getTime())
    }
  })
})

const arbDate = fc.option(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }), { nil: null })

describe('adapter totality', () => {
  test.prop(
    [
      fc.record({
        id: fc.uuid(),
        status: fc.constantFrom('todo', 'in-progress', 'done', 'weird'),
        priority: fc.constantFrom('low', 'medium', 'high', 'urgent', ''),
        columnId: fc.constantFrom('col-a', 'col-b', null, 'missing'),
        startDate: arbDate,
        endDate: arbDate,
        size: fc.option(fc.double({ min: 0, max: 20, noNaN: true }), { nil: null }),
        progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        orderIndex: fc.integer({ min: 0, max: 1000 }),
        completedAt: arbDate,
        estimateMinutes: fc.option(fc.integer({ min: -10, max: 10_000 }), { nil: null }),
        scheduleMode: fc.constantFrom('auto', 'manual', 'x'),
        constraintType: fc.constantFrom('asap', 'snet', 'fnlt', 'x'),
        constraintDate: arbDate,
        isMilestone: fc.boolean(),
        ownerResourceId: fc.constantFrom(null, 'r-u1', 'r-elsewhere'),
        startedAt: arbDate,
      }),
      fc.constantFrom<'days' | 'points'>('days', 'points'),
    ],
    { numRuns: 200 },
  )('every board row maps to a well-formed ScheduleTask that keeps its identity and dates', (r, unit) => {
    const t = toScheduleTask(r, ctx({ sizing: { unit, hoursPerPoint: 8 } }))
    expect(t.id).toBe(r.id)
    expect(['todo', 'in-progress', 'done']).toContain(t.status)
    expect(['auto', 'manual']).toContain(t.scheduleMode)
    expect(['asap', 'snet', 'fnlt']).toContain(t.constraintType)
    expect(t.plannedStart).toBe(r.startDate)
    expect(t.plannedEnd).toBe(r.endDate)
    expect(t.startedAt).toBe(r.startedAt)
    expect(t.completedAt).toBe(r.completedAt)
    expect(t.constraintDate).toBe(r.constraintDate)
    expect(t.size).toBe(r.size)
    expect(t.progress).toBe(r.progress)
    expect(t.orderIndex).toBe(r.orderIndex)
    expect(t.isMilestone).toBe(r.isMilestone)
    expect(t.ownerResourceId).toBe(r.ownerResourceId === 'r-u1' ? 'r-u1' : null)
    if (t.estimateMinutes !== null) {
      expect(Number.isInteger(t.estimateMinutes)).toBe(true)
      expect(t.estimateMinutes).toBeGreaterThan(0)
    }
    expect(Number.isFinite(t.columnOrder)).toBe(true)
    expect([0, 1, 2, 3]).toContain(t.priority)
  })
})
