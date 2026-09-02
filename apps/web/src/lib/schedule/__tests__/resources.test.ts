import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  activeResources,
  DEFAULT_CALENDAR,
  hoursPerDayByResource,
  indexResourcesByPerson,
  planMissingResources,
  resourceLabel,
  toScheduleResource,
  toWorkCalendar,
  unsavedResourceRows,
  type NewResourceRow,
  type ResourceRow,
  type SchedulePerson,
} from '../resources'

const PROJECT = 'p1'

function resourceRow(over: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'r1',
    kind: 'user',
    userId: 'u1',
    virtualMemberId: null,
    parentResourceId: null,
    calendarId: null,
    label: 'Alice',
    concurrency: 1,
    focusFactor: '1.00',
    orderIndex: 0,
    ...over,
  }
}

/** What the database would hand back after inserting a planned row. */
function inserted(plan: NewResourceRow, i: number): ResourceRow {
  return resourceRow({
    id: `new-${i}-${plan.userId ?? plan.virtualMemberId}`,
    kind: plan.kind,
    userId: plan.userId,
    virtualMemberId: plan.virtualMemberId,
    label: plan.label,
    orderIndex: plan.orderIndex,
  })
}

/** The identity rule from resources_kind_identity_check, as a predicate. */
function satisfiesIdentityCheck(r: { kind: string; userId: string | null; virtualMemberId: string | null }): boolean {
  return (
    (r.kind === 'user' && r.userId !== null && r.virtualMemberId === null) ||
    (r.kind === 'virtual' && r.virtualMemberId !== null && r.userId === null) ||
    (r.kind === 'agent' && r.userId === null && r.virtualMemberId === null)
  )
}

const arbPerson: fc.Arbitrary<SchedulePerson> = fc.oneof(
  fc.record({ kind: fc.constant<'user'>('user'), userId: fc.uuid(), label: fc.option(fc.string(), { nil: null }) }),
  fc.record({ kind: fc.constant<'virtual'>('virtual'), virtualMemberId: fc.uuid(), label: fc.option(fc.string(), { nil: null }) }),
)

describe('planMissingResources', () => {
  it('plans one row per person on a fresh project, in the order given, from index 0', () => {
    const people: SchedulePerson[] = [
      { kind: 'user', userId: 'u1', label: 'Alice' },
      { kind: 'virtual', virtualMemberId: 'v1', label: 'Bob (contractor)' },
    ]
    expect(planMissingResources(PROJECT, people, [])).toEqual([
      { projectId: PROJECT, kind: 'user', userId: 'u1', virtualMemberId: null, label: 'Alice', orderIndex: 0 },
      { projectId: PROJECT, kind: 'virtual', userId: null, virtualMemberId: 'v1', label: 'Bob (contractor)', orderIndex: 1 },
    ])
  })

  it('skips people who already have a row and continues the order index after the last one', () => {
    const existing = [resourceRow({ userId: 'u1', orderIndex: 4 })]
    const people: SchedulePerson[] = [
      { kind: 'user', userId: 'u1', label: 'Alice' },
      { kind: 'user', userId: 'u2', label: 'Carol' },
    ]
    expect(planMissingResources(PROJECT, people, existing)).toEqual([
      { projectId: PROJECT, kind: 'user', userId: 'u2', virtualMemberId: null, label: 'Carol', orderIndex: 5 },
    ])
  })

  it('collapses a person listed twice into one row', () => {
    const people: SchedulePerson[] = [
      { kind: 'user', userId: 'u1', label: 'Alice' },
      { kind: 'user', userId: 'u1', label: 'Alice again' },
    ]
    expect(planMissingResources(PROJECT, people, [])).toHaveLength(1)
  })

  test.prop([fc.array(arbPerson, { maxLength: 20 }), fc.array(arbPerson, { maxLength: 10 })], { numRuns: 100 })(
    'is idempotent: planning again against the inserted result yields nothing, and every row passes the identity CHECK',
    (people, alreadyThere) => {
      const existing = planMissingResources(PROJECT, alreadyThere, []).map(inserted)
      const first = planMissingResources(PROJECT, people, existing)
      for (const r of first) {
        expect(satisfiesIdentityCheck(r)).toBe(true)
        expect(r.projectId).toBe(PROJECT)
      }
      const after = [...existing, ...first.map((p, i) => inserted(p, 1000 + i))]
      expect(planMissingResources(PROJECT, people, after)).toEqual([])
      const ids = after.map((r) => r.userId ?? r.virtualMemberId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const person of people) {
        const key = person.kind === 'user' ? person.userId : person.virtualMemberId
        expect(ids).toContain(key)
      }
    },
  )

  test.prop([fc.array(arbPerson, { minLength: 1, maxLength: 20 }), fc.integer({ min: -1, max: 50 })], { numRuns: 60 })(
    'order indexes are unique and strictly after every existing one',
    (people, maxExisting) => {
      const existing = maxExisting < 0 ? [] : [resourceRow({ userId: 'someone-else', orderIndex: maxExisting })]
      const plan = planMissingResources(PROJECT, people, existing)
      const indexes = plan.map((p) => p.orderIndex)
      expect(new Set(indexes).size).toBe(indexes.length)
      for (const i of indexes) expect(i).toBeGreaterThan(maxExisting)
    },
  )
})

describe('activeResources', () => {
  const rows = [
    resourceRow({ id: 'a', userId: 'u1' }),
    resourceRow({ id: 'b', userId: 'u-left' }),
    resourceRow({ id: 'c', kind: 'virtual', userId: null, virtualMemberId: 'v1' }),
    resourceRow({ id: 'd', kind: 'virtual', userId: null, virtualMemberId: 'v-left' }),
    resourceRow({ id: 'e', kind: 'agent', userId: null, virtualMemberId: null }),
  ]
  const people: SchedulePerson[] = [
    { kind: 'user', userId: 'u1', label: 'Alice' },
    { kind: 'virtual', virtualMemberId: 'v1', label: 'Bob' },
  ]

  it('keeps only rows whose person is still on the project, and every agent row', () => {
    expect(activeResources(rows, people).map((r) => r.id)).toEqual(['a', 'c', 'e'])
  })

  it('an empty roster leaves only agents', () => {
    expect(activeResources(rows, []).map((r) => r.id)).toEqual(['e'])
  })

  test.prop([fc.array(arbPerson, { maxLength: 15 }), fc.array(arbPerson, { maxLength: 15 })], { numRuns: 60 })(
    'the active set is exactly the rows planned for the current roster',
    (roster, before) => {
      const rowsBefore = planMissingResources(PROJECT, before, []).map(inserted)
      const rowsNow = [...rowsBefore, ...planMissingResources(PROJECT, roster, rowsBefore).map((p, i) => inserted(p, 100 + i))]
      const active = activeResources(rowsNow, roster)
      const rosterKeys = new Set(roster.map((p) => (p.kind === 'user' ? p.userId : p.virtualMemberId)))
      expect(new Set(active.map((r) => r.userId ?? r.virtualMemberId))).toEqual(rosterKeys)
      expect(activeResources(active, roster)).toEqual(active)
    },
  )
})

describe('unsavedResourceRows', () => {
  it('turns a plan into resolvable rows with a stable synthetic id and engine defaults', () => {
    const plan = planMissingResources(PROJECT, [
      { kind: 'user', userId: 'u1', label: 'Alice' },
      { kind: 'virtual', virtualMemberId: 'v1', label: null },
    ], [])
    const rows = unsavedResourceRows(plan)
    expect(rows.map((r) => [r.id, r.kind, r.userId, r.virtualMemberId, r.label, r.orderIndex])).toEqual([
      ['unsaved:u1', 'user', 'u1', null, 'Alice', 0],
      ['unsaved:v1', 'virtual', null, 'v1', null, 1],
    ])
    for (const r of rows) expect(toScheduleResource(r)).toMatchObject({ concurrency: 1, focusFactor: 1, calendarId: null })
    expect(indexResourcesByPerson(rows).byUserId.get('u1')).toBe('unsaved:u1')
  })
})

describe('row mapping', () => {
  it('parses numeric strings and clamps nonsense back to the engine defaults', () => {
    expect(toScheduleResource(resourceRow({ focusFactor: '0.50', concurrency: 3 }))).toMatchObject({ focusFactor: 0.5, concurrency: 3, kind: 'user' })
    expect(toScheduleResource(resourceRow({ focusFactor: '0', concurrency: 0 }))).toMatchObject({ focusFactor: 1, concurrency: 1 })
    expect(toScheduleResource(resourceRow({ focusFactor: 'abc', concurrency: 2.7 }))).toMatchObject({ focusFactor: 1, concurrency: 2 })
    expect(toScheduleResource(resourceRow({ kind: 'robot' })).kind).toBe('user')
    expect(toScheduleResource(resourceRow({ kind: 'agent', userId: null })).kind).toBe('agent')
  })

  it('indexes resources by their person identity, first row wins', () => {
    const { byUserId, byVirtualMemberId } = indexResourcesByPerson([
      resourceRow({ id: 'a', userId: 'u1' }),
      resourceRow({ id: 'b', userId: 'u1' }),
      resourceRow({ id: 'c', kind: 'virtual', userId: null, virtualMemberId: 'v1' }),
    ])
    expect(byUserId.get('u1')).toBe('a')
    expect(byVirtualMemberId.get('v1')).toBe('c')
  })

  it('builds a WorkCalendar with only its own exceptions and numeric hours', () => {
    const calendar = toWorkCalendar(
      { id: 'cal-1', timezone: 'Europe/London', hoursPerDay: '7.50', dayStartMinute: 540, workweek: 62 },
      [
        { calendarId: 'cal-1', day: '2026-12-25', isWorking: false, hours: null, startMinute: null },
        { calendarId: 'cal-1', day: '2026-12-24', isWorking: true, hours: '4.00', startMinute: 780 },
        { calendarId: 'cal-2', day: '2026-12-26', isWorking: false, hours: null, startMinute: null },
      ],
    )
    expect(calendar).toEqual({
      id: 'cal-1',
      timezone: 'Europe/London',
      hoursPerDay: 7.5,
      dayStartMinute: 540,
      workweek: 62,
      exceptions: [
        { day: '2026-12-25', isWorking: false, hours: null, startMinute: null },
        { day: '2026-12-24', isWorking: true, hours: 4, startMinute: 780 },
      ],
    })
  })

  it('resolves hours per day through the resource calendar, else the default calendar', () => {
    const calendars = [
      toWorkCalendar({ id: 'default', timezone: 'UTC', hoursPerDay: '8', dayStartMinute: 540, workweek: 62 }, []),
      toWorkCalendar({ id: 'short', timezone: 'UTC', hoursPerDay: '6', dayStartMinute: 540, workweek: 62 }, []),
    ]
    const resources = [
      toScheduleResource(resourceRow({ id: 'a', calendarId: 'short' })),
      toScheduleResource(resourceRow({ id: 'b', calendarId: null })),
      toScheduleResource(resourceRow({ id: 'c', calendarId: 'deleted' })),
    ]
    const hours = hoursPerDayByResource(resources, calendars, 'default')
    expect([hours.get('a'), hours.get('b'), hours.get('c')]).toEqual([6, 8, 8])
  })

  it('the default calendar is Mon–Fri, 09:00 open, 8h, UTC', () => {
    expect(DEFAULT_CALENDAR).toEqual({ name: 'Default', timezone: 'UTC', hoursPerDay: 8, dayStartMinute: 540, workweek: 62 })
  })

  it('labels are trimmed, emptied to null and clamped to the column width', () => {
    expect(resourceLabel('  Alice ')).toBe('Alice')
    expect(resourceLabel('   ')).toBeNull()
    expect(resourceLabel(null)).toBeNull()
    expect(resourceLabel('x'.repeat(200))).toHaveLength(120)
  })
})
