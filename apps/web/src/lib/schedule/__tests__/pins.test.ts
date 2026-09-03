/**
 * Contract gaps closed in P1.5: a manual pin occupies the span the human typed
 * (`plannedStart` / `plannedEnd`), and a placement echoes the actual start
 * separately from where the remaining work is booked (`actualStart`).
 *
 * Runs on the real calendar index — lane C is finished — so these are the first
 * solver tests that cross a genuine working-time axis.
 */
import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { solve } from '../solver'
import { buildCalendarIndex } from '../calendar'
import type { ScheduleTask, SolveInput, SolveResult, WorkCalendar } from '../types'
import { LONDON_MON_FRI, NOW, RESOURCE_SOLO, task } from '../fixtures'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const WINDOW = { start: new Date(NOW.getTime() - 60 * DAY_MS), end: new Date(NOW.getTime() + 120 * DAY_MS) }
const buildIndex = (calendar: WorkCalendar) => buildCalendarIndex(calendar, WINDOW)

function run(tasks: ScheduleTask[], over: Partial<SolveInput> = {}): SolveResult {
  return solve(
    {
      tasks,
      dependencies: [],
      resources: [RESOURCE_SOLO],
      calendars: [LONDON_MON_FRI],
      now: NOW,
      defaultCalendarId: LONDON_MON_FRI.id,
      ...over,
    },
    buildIndex,
  )
}

function placementOf(result: SolveResult, id: string) {
  const p = result.placements.find((x) => x.taskId === id)
  if (!p) throw new Error(`no placement for ${id}`)
  return p
}

/** Working-day mornings after NOW: Mon 09:00 London on day `offset`, weekends skipped. */
function workingMorning(offset: number): Date {
  const weeks = Math.floor(offset / 5)
  const days = offset - weeks * 5
  return new Date(NOW.getTime() + (weeks * 7 + days) * DAY_MS)
}

describe('manual pins honour the typed span', () => {
  it('places a manual card exactly on its planned start and end', () => {
    const plannedStart = workingMorning(3)
    const plannedEnd = new Date(plannedStart.getTime() + 4 * HOUR_MS)
    const result = run([task('p', { scheduleMode: 'manual', plannedStart, plannedEnd })])
    const p = placementOf(result, 'p')
    expect(p.computedStart.getTime()).toBe(plannedStart.getTime())
    expect(p.computedEnd.getTime()).toBe(plannedEnd.getTime())
    expect(result.warnings).toEqual([])
  })

  it('falls back to the estimate when the typed end is not after the typed start', () => {
    const plannedStart = workingMorning(2)
    const result = run([
      task('p', {
        scheduleMode: 'manual',
        plannedStart,
        plannedEnd: new Date(plannedStart.getTime() - HOUR_MS),
        estimateMinutes: 120,
      }),
    ])
    const p = placementOf(result, 'p')
    expect(p.computedStart.getTime()).toBe(plannedStart.getTime())
    expect(p.computedEnd.getTime()).toBe(plannedStart.getTime() + 2 * HOUR_MS)
  })

  it('precedence: actual start > planned start > constraint date > now', () => {
    const startedAt = workingMorning(1)
    const plannedStart = workingMorning(2)
    const constraintDate = workingMorning(3)
    const all = placementOf(
      run([task('p', { scheduleMode: 'manual', startedAt, plannedStart, constraintDate })]),
      'p',
    )
    expect(all.computedStart.getTime()).toBe(startedAt.getTime())
    const noActual = placementOf(
      run([task('p', { scheduleMode: 'manual', plannedStart, constraintDate })]),
      'p',
    )
    expect(noActual.computedStart.getTime()).toBe(plannedStart.getTime())
    const constraintOnly = placementOf(
      run([task('p', { scheduleMode: 'manual', constraintDate })]),
      'p',
    )
    expect(constraintOnly.computedStart.getTime()).toBe(constraintDate.getTime())
    const bare = placementOf(run([task('p', { scheduleMode: 'manual' })]), 'p')
    expect(bare.computedStart.getTime()).toBe(NOW.getTime())
  })

  it('a completed-at beats the typed end on a manual card', () => {
    const plannedStart = workingMorning(1)
    const plannedEnd = new Date(plannedStart.getTime() + 6 * HOUR_MS)
    const completedAt = new Date(plannedStart.getTime() + 2 * HOUR_MS)
    const p = placementOf(
      run([task('p', { scheduleMode: 'manual', plannedStart, plannedEnd, completedAt })]),
      'p',
    )
    expect(p.computedEnd.getTime()).toBe(completedAt.getTime())
  })

  it('two manual cards with identical typed spans on one lane keep their dates and raise resource-overbooked', () => {
    const plannedStart = workingMorning(2)
    const plannedEnd = new Date(plannedStart.getTime() + 4 * HOUR_MS)
    const result = run([
      task('m0', { scheduleMode: 'manual', plannedStart, plannedEnd, orderIndex: 0 }),
      task('m1', { scheduleMode: 'manual', plannedStart, plannedEnd, orderIndex: 1 }),
    ])
    for (const id of ['m0', 'm1']) {
      const p = placementOf(result, id)
      expect(p.computedStart.getTime()).toBe(plannedStart.getTime())
      expect(p.computedEnd.getTime()).toBe(plannedEnd.getTime())
    }
    const overbooked = result.warnings.filter((w) => w.kind === 'resource-overbooked')
    expect(overbooked).toHaveLength(1)
    expect([...overbooked[0].taskIds].sort()).toEqual(['m0', 'm1'])
    expect(placementOf(result, 'm0').laneIndex).not.toBe(placementOf(result, 'm1').laneIndex)
  })

  test.prop(
    [fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 8 })],
    { numRuns: 60 },
  )(
    'N manual cards with disjoint typed spans on one lane never overbook and keep their dates',
    (dayOffsets) => {
      const tasks = dayOffsets.map((offset, i) => {
        const plannedStart = workingMorning(offset)
        return task(`m${i}`, {
          scheduleMode: 'manual',
          plannedStart,
          plannedEnd: new Date(plannedStart.getTime() + 8 * HOUR_MS),
          orderIndex: i,
        })
      })
      const result = run(tasks)
      expect(result.warnings.filter((w) => w.kind === 'resource-overbooked')).toEqual([])
      for (const t of tasks) {
        const p = placementOf(result, t.id)
        expect(p.computedStart.getTime()).toBe((t.plannedStart as Date).getTime())
        expect(p.computedEnd.getTime()).toBe((t.plannedEnd as Date).getTime())
        expect(p.laneIndex).toBe(0)
      }
    },
  )

  test.prop([fc.integer({ min: 2, max: 6 })], { numRuns: 20 })(
    'without typed dates every bare manual card still collapses onto now (the pre-fix shape, kept honest by a warning)',
    (count) => {
      const tasks = Array.from({ length: count }, (_, i) =>
        task(`m${i}`, { scheduleMode: 'manual', orderIndex: i }),
      )
      const result = run(tasks)
      expect(result.warnings.some((w) => w.kind === 'resource-overbooked')).toBe(true)
      for (const t of tasks) expect(placementOf(result, t.id).computedStart.getTime()).toBe(NOW.getTime())
    },
  )

  test.prop([fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 16 })], { numRuns: 40 })(
    'auto work ignores typed dates entirely',
    (offset, hours) => {
      const plannedStart = workingMorning(offset)
      const plannedEnd = new Date(plannedStart.getTime() + hours * HOUR_MS)
      const withDates = placementOf(run([task('a', { plannedStart, plannedEnd })]), 'a')
      const without = placementOf(run([task('a')]), 'a')
      expect(withDates.computedStart.getTime()).toBe(without.computedStart.getTime())
      expect(withDates.computedEnd.getTime()).toBe(without.computedEnd.getTime())
    },
  )
})

describe('actualStart on a placement', () => {
  it('echoes startedAt for in-progress work while computedStart stays at or after now', () => {
    const startedAt = new Date(NOW.getTime() - 3 * DAY_MS)
    const p = placementOf(
      run([task('a', { status: 'in-progress', startedAt, progress: 50, estimateMinutes: 16 * 60 })]),
      'a',
    )
    expect(p.actualStart?.getTime()).toBe(startedAt.getTime())
    expect(p.computedStart.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('is null when work has not started', () => {
    expect(placementOf(run([task('a')]), 'a').actualStart).toBeNull()
  })

  it('leaves by value: mutating it cannot touch the input', () => {
    const startedAt = new Date(NOW.getTime() - DAY_MS)
    const source = task('a', { status: 'in-progress', startedAt })
    const p = placementOf(run([source]), 'a')
    ;(p.actualStart as Date).setTime(0)
    expect(source.startedAt?.getTime()).toBe(startedAt.getTime())
  })

  test.prop(
    [
      fc.array(
        fc.record({
          status: fc.constantFrom<ScheduleTask['status']>('todo', 'in-progress', 'done'),
          mode: fc.constantFrom<ScheduleTask['scheduleMode']>('auto', 'manual'),
          startedOffsetDays: fc.option(fc.integer({ min: -20, max: 5 }), { nil: null }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
    ],
    { numRuns: 60 },
  )('every placement carries exactly the task\'s startedAt, never a derived instant', (specs) => {
    const tasks = specs.map((spec, i) =>
      task(`t${i}`, {
        status: spec.status,
        scheduleMode: spec.mode,
        startedAt:
          spec.startedOffsetDays === null ? null : new Date(NOW.getTime() + spec.startedOffsetDays * DAY_MS),
        orderIndex: i,
      }),
    )
    const result = run(tasks)
    for (const t of tasks) {
      const p = placementOf(result, t.id)
      if (t.startedAt) expect(p.actualStart?.getTime()).toBe(t.startedAt.getTime())
      else expect(p.actualStart).toBeNull()
    }
  })
})
