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

/** Last working instant at or before `instant` — the stub's mirror of the real rule. */
function displayEnd(instant: Date): Date {
  const ms = instant.getTime()
  const raw = minuteOfDay(ms)
  let day = dayIndexOf(ms)
  const onWeekday = dayOfWeek(day) < 5
  if (onWeekday && raw > DAY_START_MIN && raw <= DAY_END_MIN) return instant
  if (!(onWeekday && raw > DAY_END_MIN)) day -= 1
  while (dayOfWeek(day) >= 5) day -= 1
  return new Date(ANCHOR + day * DAY_MS + DAY_END_MIN * MIN_MS)
}

function stubIndex(calendar: WorkCalendar): CalendarIndex {
  return {
    calendarId: calendar.id,
    timezone: 'UTC',
    hoursPerDay: 8,
    dayStartMinute: DAY_START_MIN,
    toWorkMinutes: workMinutes,
    fromWorkMinutes: instantAt,
    addDuration: (start, minutes) => instantAt(workMinutes(start) + minutes),
    workingMinutesBetween: (a, b) => workMinutes(b) - workMinutes(a),
    snapToNextWorkingInstant: (instant) =>
      isWorking(instant) ? instant : instantAt(workMinutes(instant)),
    isWorkingInstant: isWorking,
    toDisplayEnd: displayEnd,
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

interface MixedSpec {
  mode: 'auto' | 'manual' | 'done'
  startDays: number
  lengthMin: number
  ownerIdx: number
  orderIndex: number
  priority: number
  columnOrder: number
  altColumnOrder: number
}

/** Auto work mixed with pins and actuals, carrying two competing board positions. */
const fixedSpecArb: fc.Arbitrary<MixedSpec> = fc.record({
  mode: fc.constantFrom<MixedSpec['mode']>('auto', 'manual', 'done'),
  startDays: fc.integer({ min: -5, max: 5 }),
  lengthMin: fc.integer({ min: 0, max: 1200 }),
  ownerIdx: fc.integer({ min: 0, max: 2 }),
  orderIndex: fc.integer({ min: 0, max: 3 }),
  priority: fc.integer({ min: 0, max: 2 }),
  columnOrder: fc.integer({ min: 0, max: 4 }),
  altColumnOrder: fc.integer({ min: 0, max: 4 }),
})

function buildMixed(specs: MixedSpec[], useAlt: boolean): ScheduleTask[] {
  return specs.map((spec, i) => {
    const startedAt = new Date(NOW.getTime() + spec.startDays * DAY_MS)
    const base: Partial<ScheduleTask> = {
      ownerResourceId: RESOURCES[spec.ownerIdx % RESOURCES.length].id,
      estimateMinutes: spec.lengthMin,
      columnOrder: useAlt ? spec.altColumnOrder : spec.columnOrder,
      orderIndex: spec.orderIndex,
      priority: spec.priority,
    }
    if (spec.mode === 'done') {
      return task(`t${i}`, {
        ...base,
        status: 'done',
        progress: 100,
        startedAt,
        completedAt: new Date(startedAt.getTime() + spec.lengthMin * MIN_MS),
      })
    }
    if (spec.mode === 'manual') {
      return task(`t${i}`, { ...base, scheduleMode: 'manual', startedAt })
    }
    return task(`t${i}`, base)
  })
}

/** Overbooking reports compared as a set — only the sweep's warning order is positional. */
function overbookings(result: SolveResult): string[] {
  return result.warnings
    .filter((w) => w.kind === 'resource-overbooked')
    .map((w) => w.taskIds.join('|'))
    .sort()
}

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

/**
 * Pins and actuals are placed before the sweep, so they defend their slots against
 * work the sweep would otherwise have put there first. Board position must never
 * decide whether that defence happens.
 */
describe('immovable pins and actuals', () => {
  /** Friday 08:00 through Monday 12:00 on the stub axis: 720 working minutes. */
  const PIN_START = new Date('2026-09-04T08:00:00.000Z')
  const PIN_END = new Date('2026-09-07T12:00:00.000Z')

  function probe(kind: 'manual' | 'done', pinFirst: boolean): SolveResult {
    const pin =
      kind === 'manual'
        ? task('pin', {
            scheduleMode: 'manual',
            startedAt: PIN_START,
            estimateMinutes: 720,
            columnOrder: pinFirst ? 0 : 1,
          })
        : task('pin', {
            status: 'done',
            progress: 100,
            startedAt: PIN_START,
            completedAt: PIN_END,
            columnOrder: pinFirst ? 0 : 1,
          })
    const auto = task('auto', { estimateMinutes: 480, columnOrder: pinFirst ? 1 : 0 })
    return run({ tasks: [pin, auto], dependencies: [] })
  }

  function spans(result: SolveResult): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const placement of [...result.placements].sort((a, b) =>
      a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
    )) {
      out[placement.taskId] = {
        start: iso(placement.computedStart),
        end: iso(placement.computedEnd),
        lane: placement.laneIndex,
      }
    }
    return out
  }

  const CASES: [string, 'manual' | 'done', boolean][] = [
    ['manual-first', 'manual', true],
    ['manual-second', 'manual', false],
    ['done-first', 'done', true],
    ['done-second', 'done', false],
  ]

  it('places a pin identically whichever side of the sweep it falls on', () => {
    const expected = {
      auto: { start: '2026-09-07T12:00:00.000Z', end: '2026-09-08T12:00:00.000Z', lane: 0 },
      pin: { start: '2026-09-04T08:00:00.000Z', end: '2026-09-07T12:00:00.000Z', lane: 0 },
    }
    for (const [label, kind, pinFirst] of CASES) {
      const result = probe(kind, pinFirst)
      expect(spans(result), label).toEqual(expected)
      expect(result.warnings, label).toEqual([])
    }
  })

  it('never lets a pin and the sweep share one lane', () => {
    for (const [, kind, pinFirst] of CASES) {
      const result = probe(kind, pinFirst)
      const pin = at(result, 'pin')
      const auto = at(result, 'auto')
      expect(pin.laneIndex).toBe(auto.laneIndex)
      expect(auto.computedStart.getTime()).toBeGreaterThanOrEqual(pin.computedEnd.getTime())
    }
  })

  it('keeps two genuinely overlapping actuals on their own dates and flags the overbooking', () => {
    const first = task('d1', {
      status: 'done',
      progress: 100,
      startedAt: new Date('2026-09-01T08:00:00.000Z'),
      completedAt: new Date('2026-09-03T08:00:00.000Z'),
      columnOrder: 0,
    })
    const second = task('d2', {
      status: 'done',
      progress: 100,
      startedAt: new Date('2026-09-02T08:00:00.000Z'),
      completedAt: new Date('2026-09-04T08:00:00.000Z'),
      columnOrder: 1,
    })
    const result = run({ tasks: [first, second], dependencies: [] })
    expect(iso(at(result, 'd1').computedStart)).toBe('2026-09-01T08:00:00.000Z')
    expect(iso(at(result, 'd1').computedEnd)).toBe('2026-09-03T08:00:00.000Z')
    expect(iso(at(result, 'd2').computedStart)).toBe('2026-09-02T08:00:00.000Z')
    expect(iso(at(result, 'd2').computedEnd)).toBe('2026-09-04T08:00:00.000Z')
    expect(at(result, 'd1').laneIndex).toBe(0)
    expect(at(result, 'd2').laneIndex).toBe(1)
    const overbooked = result.warnings.filter((w) => w.kind === 'resource-overbooked')
    expect(overbooked).toHaveLength(1)
    expect(overbooked[0].taskIds).toEqual(['d2', 'd1'])
  })

  it('reports the same overbooking whichever way round the two actuals are ordered', () => {
    const build = (flipped: boolean) => [
      task('d1', {
        status: 'done',
        progress: 100,
        startedAt: new Date('2026-09-01T08:00:00.000Z'),
        completedAt: new Date('2026-09-03T08:00:00.000Z'),
        columnOrder: flipped ? 1 : 0,
      }),
      task('d2', {
        status: 'done',
        progress: 100,
        startedAt: new Date('2026-09-02T08:00:00.000Z'),
        completedAt: new Date('2026-09-04T08:00:00.000Z'),
        columnOrder: flipped ? 0 : 1,
      }),
    ]
    const straight = run({ tasks: build(false), dependencies: [] })
    const flipped = run({ tasks: build(true), dependencies: [] })
    expect(spans(flipped)).toEqual(spans(straight))
    expect(flipped.warnings.filter((w) => w.kind === 'resource-overbooked')).toEqual(
      straight.warnings.filter((w) => w.kind === 'resource-overbooked'),
    )
  })

  it('gives a fourth overlapping pin on a concurrency-3 resource its own overflow lane', () => {
    const startedAt = new Date('2026-09-01T08:00:00.000Z')
    const completedAt = new Date('2026-09-03T08:00:00.000Z')
    const tasks = ['a1', 'a2', 'a3', 'a4'].map((id, i) =>
      task(id, {
        status: 'done',
        progress: 100,
        ownerResourceId: RESOURCE_AGENT.id,
        startedAt,
        completedAt,
        columnOrder: i,
      }),
    )
    const result = run({ tasks, dependencies: [] })
    const lanes = tasks.map((t) => at(result, t.id).laneIndex)
    expect([...lanes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    expect(new Set(lanes).size).toBe(4)
    for (const t of tasks) {
      expect(iso(at(result, t.id).computedStart)).toBe(iso(startedAt))
      expect(iso(at(result, t.id).computedEnd)).toBe(iso(completedAt))
    }
    const overbooked = result.warnings.filter((w) => w.kind === 'resource-overbooked')
    expect(overbooked).toHaveLength(1)
    expect(overbooked[0].taskIds).toEqual(['a4', 'a1', 'a2', 'a3'])
  })

  it('leaves an unestimated pin out of capacity entirely', () => {
    const result = run({
      tasks: [
        task('p', { scheduleMode: 'manual', startedAt: NOW, estimateMinutes: null }),
        task('q', { estimateMinutes: 480 }),
      ],
      dependencies: [],
    })
    expect(iso(at(result, 'q').computedStart)).toBe(iso(NOW))
    expect(result.warnings.filter((w) => w.kind === 'resource-overbooked')).toEqual([])
  })

  test.prop([fc.array(fixedSpecArb, { minLength: 1, maxLength: 8 })])(
    'reordering columnOrder never moves a done or manual placement',
    (specs) => {
      const straight = run({ tasks: buildMixed(specs, false), dependencies: [] })
      const reordered = run({ tasks: buildMixed(specs, true), dependencies: [] })
      const immovableIds = specs
        .map((spec, i) => (spec.mode === 'auto' ? null : `t${i}`))
        .filter((id): id is string => id !== null)
      for (const id of immovableIds) {
        const before = at(straight, id)
        const after = at(reordered, id)
        expect(iso(after.computedStart)).toBe(iso(before.computedStart))
        expect(iso(after.computedEnd)).toBe(iso(before.computedEnd))
        expect(after.laneIndex).toBe(before.laneIndex)
      }
      expect(overbookings(reordered)).toEqual(overbookings(straight))
    },
  )
})
