/**
 * Chronos solver suite (lane B2). The calendar index is a local stub — Mon–Fri,
 * 08:00–16:00 UTC, no exceptions — so the solver is proven in isolation from
 * lane C's real builder, which is still in flight.
 */
import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { solve } from '../solver'
import {
  UNESTIMATED_DEFAULT_MINUTES,
  type CalendarIndex,
  type Placement,
  type ScheduleDependency,
  type ScheduleResource,
  type ScheduleTask,
  type SolveInput,
  type SolveResult,
  type WorkCalendar,
} from '../types'
import {
  CHAIN_OF_THREE,
  CYCLE_OF_TWO,
  IN_PROGRESS_HALF,
  LONDON_MON_FRI,
  NOW,
  RESOURCE_AGENT,
  RESOURCE_HALF_TIME,
  RESOURCE_SOLO,
  STALE_TODO,
  task,
} from '../fixtures'

const DAY_MS = 86_400_000
const MIN_MS = 60_000
/** Monday 2026-01-05, the zero of the stub's working-time axis. */
const ANCHOR = Date.UTC(2026, 0, 5)
const DAY_START_MIN = 8 * 60
const DAY_END_MIN = 16 * 60
const DAY_WORK_MIN = DAY_END_MIN - DAY_START_MIN

function dayIndexOf(ms: number): number {
  return Math.floor((ms - ANCHOR) / DAY_MS)
}

function minuteOfDay(ms: number): number {
  return (ms - ANCHOR - dayIndexOf(ms) * DAY_MS) / MIN_MS
}

function dayOfWeek(dayIndex: number): number {
  return dayIndex - Math.floor(dayIndex / 7) * 7
}

function workMinutes(instant: Date): number {
  const ms = instant.getTime()
  const dayIndex = dayIndexOf(ms)
  const week = Math.floor(dayIndex / 7)
  const dow = dayIndex - week * 7
  const wholeDays = week * 5 + Math.min(dow, 5)
  const raw = minuteOfDay(ms)
  const within = dow < 5 ? Math.min(Math.max(raw, DAY_START_MIN), DAY_END_MIN) - DAY_START_MIN : 0
  return wholeDays * DAY_WORK_MIN + within
}

function instantAt(workMin: number): Date {
  const day = Math.floor(workMin / DAY_WORK_MIN)
  const rest = workMin - day * DAY_WORK_MIN
  const week = Math.floor(day / 5)
  const dayIndex = week * 7 + (day - week * 5)
  return new Date(ANCHOR + dayIndex * DAY_MS + (DAY_START_MIN + rest) * MIN_MS)
}

function isWorking(instant: Date): boolean {
  const ms = instant.getTime()
  const raw = minuteOfDay(ms)
  return dayOfWeek(dayIndexOf(ms)) < 5 && raw >= DAY_START_MIN && raw < DAY_END_MIN
}

function stubIndex(calendar: WorkCalendar): CalendarIndex {
  return {
    calendarId: calendar.id,
    timezone: 'UTC',
    hoursPerDay: 8,
    toWorkMinutes: workMinutes,
    fromWorkMinutes: instantAt,
    addDuration: (start, minutes) => instantAt(workMinutes(start) + minutes),
    workingMinutesBetween: (a, b) => workMinutes(b) - workMinutes(a),
    snapToNextWorkingInstant: (instant) =>
      isWorking(instant) ? instant : instantAt(workMinutes(instant)),
    isWorkingInstant: isWorking,
  }
}

const IDX = stubIndex(LONDON_MON_FRI)

/** Mirrors the solver's own bidirectional shift so precedence is asserted on its terms. */
function shiftBy(instant: Date, minutes: number): Date {
  if (minutes === 0) return instant
  return instantAt(workMinutes(instant) + minutes)
}

const RESOURCES: ScheduleResource[] = [RESOURCE_SOLO, RESOURCE_AGENT, RESOURCE_HALF_TIME]

interface Scenario {
  tasks: ScheduleTask[]
  dependencies: ScheduleDependency[]
}

function run(scenario: Scenario, over: Partial<SolveInput> = {}): SolveResult {
  return solve(
    {
      tasks: scenario.tasks,
      dependencies: scenario.dependencies,
      resources: RESOURCES,
      calendars: [LONDON_MON_FRI],
      now: NOW,
      defaultCalendarId: LONDON_MON_FRI.id,
      ...over,
    },
    stubIndex,
  )
}

function placementMap(result: SolveResult): Map<string, Placement> {
  return new Map(result.placements.map((p) => [p.taskId, p]))
}

function at(result: SolveResult, id: string): Placement {
  const found = placementMap(result).get(id)
  if (!found) throw new Error(`no placement for ${id}`)
  return found
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function maxConcurrent(spans: { start: number; end: number }[]): number {
  const events: [number, number][] = []
  for (const span of spans) {
    events.push([span.start, 1])
    events.push([span.end, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    if (current > peak) peak = current
  }
  return peak
}

function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items]
  let state = ((seed + 1) * 2654435761) % 4294967296
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296
    const j = state % (i + 1)
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}

const specArb = fc.record({
  estimate: fc.integer({ min: 0, max: 2400 }),
  ownerIdx: fc.integer({ min: 0, max: 2 }),
  columnOrder: fc.integer({ min: 0, max: 2 }),
  orderIndex: fc.integer({ min: 0, max: 5 }),
  priority: fc.integer({ min: 0, max: 3 }),
  inProgress: fc.boolean(),
  progress: fc.integer({ min: 0, max: 100 }),
  milestone: fc.boolean(),
  snet: fc.option(fc.integer({ min: -2880, max: 14400 }), { nil: null }),
})

const linkArb = fc.record({
  from: fc.integer({ min: 0, max: 16 }),
  gap: fc.integer({ min: 0, max: 16 }),
  lag: fc.integer({ min: -240, max: 960 }),
})

/** Links always run low index -> high index, so the generated graph is a DAG. */
const dagArb: fc.Arbitrary<Scenario> = fc
  .record({
    specs: fc.array(specArb, { minLength: 1, maxLength: 7 }),
    links: fc.array(linkArb, { maxLength: 12 }),
  })
  .map(({ specs, links }) => {
    const n = specs.length
    const tasks = specs.map((spec, i) =>
      task(`t${i}`, {
        status: spec.inProgress ? 'in-progress' : 'todo',
        estimateMinutes: spec.estimate,
        progress: spec.inProgress ? spec.progress : null,
        ownerResourceId: RESOURCES[spec.ownerIdx % RESOURCES.length].id,
        startedAt: spec.inProgress ? new Date(NOW.getTime() - 3 * DAY_MS) : null,
        isMilestone: spec.milestone,
        constraintType: spec.snet === null ? 'asap' : 'snet',
        constraintDate: spec.snet === null ? null : new Date(NOW.getTime() + spec.snet * MIN_MS),
        columnOrder: spec.columnOrder,
        orderIndex: spec.orderIndex,
        priority: spec.priority,
      }),
    )
    const seen = new Set<string>()
    const dependencies: ScheduleDependency[] = []
    for (const link of links) {
      const from = link.from % n
      const to = from + 1 + (link.gap % n)
      if (to >= n) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      dependencies.push({
        blockerTaskId: `t${from}`,
        blockedTaskId: `t${to}`,
        type: 'fs',
        lagMinutes: link.lag,
      })
    }
    return { tasks, dependencies }
  })

describe('stub calendar index', () => {
  it('models Mon-Fri 08:00-16:00 UTC', () => {
    expect(isWorking(NOW)).toBe(true)
    expect(iso(IDX.addDuration(NOW, 480))).toBe('2026-09-08T08:00:00.000Z')
    expect(iso(IDX.addDuration(NOW, 480 * 5))).toBe('2026-09-14T08:00:00.000Z')
    expect(iso(IDX.snapToNextWorkingInstant(new Date('2026-09-12T10:00:00.000Z')))).toBe(
      '2026-09-14T08:00:00.000Z',
    )
    expect(IDX.workingMinutesBetween(NOW, new Date('2026-09-14T08:00:00.000Z'))).toBe(480 * 5)
    expect(iso(IDX.fromWorkMinutes(IDX.toWorkMinutes(NOW)))).toBe(iso(NOW))
  })
})

describe('solver properties', () => {
  test.prop([dagArb])('no task starts before a predecessor finishes plus lag', (scenario) => {
    const result = run(scenario)
    const placed = placementMap(result)
    for (const dep of scenario.dependencies) {
      const upstream = placed.get(dep.blockerTaskId)
      const downstream = placed.get(dep.blockedTaskId)
      expect(upstream).toBeDefined()
      expect(downstream).toBeDefined()
      const gate = shiftBy((upstream as Placement).computedEnd, dep.lagMinutes)
      expect((downstream as Placement).computedStart.getTime()).toBeGreaterThanOrEqual(
        gate.getTime(),
      )
    }
  })

  test.prop([dagArb])('no resource is over-subscribed beyond its concurrency', (scenario) => {
    const result = run(scenario)
    const byResource = new Map<string, Placement[]>()
    for (const placement of result.placements) {
      if (!placement.ownerResourceId) continue
      if (placement.computedEnd.getTime() <= placement.computedStart.getTime()) continue
      const bucket = byResource.get(placement.ownerResourceId)
      if (bucket) bucket.push(placement)
      else byResource.set(placement.ownerResourceId, [placement])
    }
    for (const [resourceId, placements] of byResource) {
      const resource = RESOURCES.find((r) => r.id === resourceId) as ScheduleResource
      const spans = placements.map((p) => ({
        start: p.computedStart.getTime(),
        end: p.computedEnd.getTime(),
      }))
      expect(maxConcurrent(spans)).toBeLessThanOrEqual(resource.concurrency)
      const byLane = new Map<number, { start: number; end: number }[]>()
      for (const placement of placements) {
        expect(placement.laneIndex).toBeGreaterThanOrEqual(0)
        expect(placement.laneIndex).toBeLessThan(resource.concurrency)
        const span = {
          start: placement.computedStart.getTime(),
          end: placement.computedEnd.getTime(),
        }
        const lane = byLane.get(placement.laneIndex)
        if (lane) lane.push(span)
        else byLane.set(placement.laneIndex, [span])
      }
      for (const lane of byLane.values()) expect(maxConcurrent(lane)).toBeLessThanOrEqual(1)
    }
  })

  test.prop([dagArb, fc.integer({ min: 0, max: 9999 })])(
    'is deterministic across repeat solves and input permutations',
    (scenario, seed) => {
      const first = JSON.stringify(run(scenario))
      const second = JSON.stringify(run(scenario))
      expect(second).toBe(first)
      const permuted = JSON.stringify(
        run(
          {
            tasks: shuffled(scenario.tasks, seed),
            dependencies: shuffled(scenario.dependencies, seed + 7),
          },
          { resources: shuffled(RESOURCES, seed + 13) },
        ),
      )
      expect(permuted).toBe(first)
    },
  )

  test.prop([dagArb])('never places work on a non-working instant', (scenario) => {
    const result = run(scenario)
    const byId = new Map(scenario.tasks.map((t) => [t.id, t]))
    for (const placement of result.placements) {
      const source = byId.get(placement.taskId) as ScheduleTask
      expect(IDX.isWorkingInstant(placement.computedStart)).toBe(true)
      expect(IDX.isWorkingInstant(placement.computedEnd)).toBe(true)
      if (source.status === 'todo') {
        expect(placement.computedStart.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
      }
    }
  })
})

describe('solver rules', () => {
  it('walks a chain in dependency order', () => {
    const result = run(CHAIN_OF_THREE)
    expect(iso(at(result, 'a').computedStart)).toBe('2026-09-07T08:00:00.000Z')
    expect(iso(at(result, 'a').computedEnd)).toBe('2026-09-08T08:00:00.000Z')
    expect(iso(at(result, 'b').computedStart)).toBe('2026-09-08T08:00:00.000Z')
    expect(iso(at(result, 'c').computedStart)).toBe('2026-09-09T08:00:00.000Z')
    expect(iso(result.projectEnd)).toBe('2026-09-10T08:00:00.000Z')
    expect(result.placements.every((p) => p.isCritical)).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('drops exactly the cycle-closing edge and still returns a plan', () => {
    const result = run(CYCLE_OF_TWO)
    expect(result.placements).toHaveLength(2)
    const cycleWarnings = result.warnings.filter((w) => w.kind === 'cycle-edge-dropped')
    expect(cycleWarnings).toHaveLength(1)
    expect(cycleWarnings[0].taskIds).toEqual(['b', 'a'])
    expect(at(result, 'b').computedStart.getTime()).toBeGreaterThanOrEqual(
      at(result, 'a').computedEnd.getTime(),
    )
  })

  it('re-projects a stale todo to now instead of the past', () => {
    const result = run(STALE_TODO)
    const placement = at(result, 'a')
    expect(iso(placement.computedStart)).toBe(iso(NOW))
    expect(placement.computedStart.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
    expect(result.warnings.filter((w) => w.kind === 'constraint-violated')).toEqual([])
  })

  it('schedules only the remaining effort of an in-progress task', () => {
    const result = run(IN_PROGRESS_HALF)
    const placement = at(result, 'a')
    expect(iso(placement.computedStart)).toBe('2026-09-03T08:00:00.000Z')
    expect(IDX.workingMinutesBetween(placement.computedStart, placement.computedEnd)).toBe(1200)
    expect(iso(placement.computedEnd)).toBe('2026-09-07T12:00:00.000Z')
  })

  it('keeps a done task on its historical span', () => {
    const startedAt = new Date('2026-08-03T08:00:00.000Z')
    const completedAt = new Date('2026-08-05T16:00:00.000Z')
    const result = run({
      tasks: [task('d', { status: 'done', progress: 100, startedAt, completedAt })],
      dependencies: [],
    })
    const placement = at(result, 'd')
    expect(iso(placement.computedStart)).toBe(iso(startedAt))
    expect(iso(placement.computedEnd)).toBe(iso(completedAt))
  })

  it('places an unestimated task at the default span and flags it', () => {
    const result = run({
      tasks: [task('u', { estimateMinutes: null })],
      dependencies: [],
    })
    const placement = at(result, 'u')
    expect(IDX.workingMinutesBetween(placement.computedStart, placement.computedEnd)).toBe(
      UNESTIMATED_DEFAULT_MINUTES,
    )
    const flagged = result.warnings.filter((w) => w.kind === 'unestimated')
    expect(flagged).toHaveLength(1)
    expect(flagged[0].taskIds).toEqual(['u'])
  })

  it('runs three overlapping reservations on a concurrency-3 resource', () => {
    const result = run({
      tasks: ['p', 'q', 'r'].map((id, i) =>
        task(id, { ownerResourceId: RESOURCE_AGENT.id, orderIndex: i }),
      ),
      dependencies: [],
    })
    const starts = ['p', 'q', 'r'].map((id) => iso(at(result, id).computedStart))
    expect(new Set(starts)).toEqual(new Set([iso(NOW)]))
    const lanes = ['p', 'q', 'r'].map((id) => at(result, id).laneIndex)
    expect([...lanes].sort()).toEqual([0, 1, 2])
  })

  it('doubles the span of a half-time resource', () => {
    const result = run({
      tasks: [task('h', { ownerResourceId: RESOURCE_HALF_TIME.id })],
      dependencies: [],
    })
    const placement = at(result, 'h')
    expect(IDX.workingMinutesBetween(placement.computedStart, placement.computedEnd)).toBe(960)
  })

  it('gives a sub-unit concurrency one real lane instead of an invalid date', () => {
    const fractional: ScheduleResource = { ...RESOURCE_SOLO, id: 'res-frac', concurrency: 0.5 }
    const result = solve(
      {
        tasks: [
          task('x', { ownerResourceId: fractional.id, orderIndex: 0 }),
          task('y', { ownerResourceId: fractional.id, orderIndex: 1 }),
        ],
        dependencies: [],
        resources: [fractional],
        calendars: [LONDON_MON_FRI],
        now: NOW,
        defaultCalendarId: LONDON_MON_FRI.id,
      },
      stubIndex,
    )
    for (const placement of result.placements) {
      expect(Number.isFinite(placement.computedStart.getTime())).toBe(true)
      expect(Number.isFinite(placement.computedEnd.getTime())).toBe(true)
      expect(placement.laneIndex).toBe(0)
    }
    expect(at(result, 'y').computedStart.getTime()).toBeGreaterThanOrEqual(
      at(result, 'x').computedEnd.getTime(),
    )
  })

  it('gives a parallel branch its slack and keeps the long path critical', () => {
    const result = run({
      tasks: [
        task('a', { orderIndex: 0 }),
        task('c', { orderIndex: 1 }),
        task('b', { orderIndex: 2, ownerResourceId: RESOURCE_AGENT.id }),
      ],
      dependencies: [{ blockerTaskId: 'a', blockedTaskId: 'c', type: 'fs', lagMinutes: 0 }],
    })
    expect(at(result, 'a').isCritical).toBe(true)
    expect(at(result, 'c').isCritical).toBe(true)
    expect(at(result, 'b').isCritical).toBe(false)
    expect(at(result, 'b').totalFloatMin).toBe(480)
  })

  it('still places work when the owner is unknown or absent, with a warning each', () => {
    const result = run({
      tasks: [task('k', { ownerResourceId: 'nope' }), task('l', { ownerResourceId: null })],
      dependencies: [],
    })
    expect(result.warnings.map((w) => w.kind)).toEqual(['unknown-resource', 'no-owner'])
    expect(result.placements).toHaveLength(2)
    expect(iso(at(result, 'k').computedStart)).toBe(iso(NOW))
    expect(iso(at(result, 'l').computedStart)).toBe(iso(NOW))
  })

  it('drops one edge from a three-node cycle and orders the survivors', () => {
    const result = run({
      tasks: [
        task('a', { orderIndex: 0 }),
        task('b', { orderIndex: 1 }),
        task('c', { orderIndex: 2 }),
      ],
      dependencies: [
        { blockerTaskId: 'a', blockedTaskId: 'b', type: 'fs', lagMinutes: 0 },
        { blockerTaskId: 'b', blockedTaskId: 'c', type: 'fs', lagMinutes: 0 },
        { blockerTaskId: 'c', blockedTaskId: 'a', type: 'fs', lagMinutes: 0 },
      ],
    })
    const cycleWarnings = result.warnings.filter((w) => w.kind === 'cycle-edge-dropped')
    expect(cycleWarnings).toHaveLength(1)
    expect(cycleWarnings[0].taskIds).toEqual(['c', 'a'])
    expect(iso(at(result, 'a').computedStart)).toBe('2026-09-07T08:00:00.000Z')
    expect(iso(at(result, 'b').computedStart)).toBe('2026-09-08T08:00:00.000Z')
    expect(iso(at(result, 'c').computedStart)).toBe('2026-09-09T08:00:00.000Z')
  })
})
