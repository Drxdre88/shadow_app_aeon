import { describe, expect, it } from 'vitest'
import {
  calendarExceptionSchema,
  createResourceSchema,
  createWorkCalendarSchema,
  updateResourceSchema,
  updateWorkCalendarSchema,
} from '../validators'

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('work calendar schema', () => {
  it('accepts a real IANA zone and fills the Mon–Fri 09:00 8h defaults', () => {
    expect(createWorkCalendarSchema.parse({ name: 'Team', timezone: 'Europe/London' })).toEqual({
      name: 'Team',
      timezone: 'Europe/London',
      hoursPerDay: 8,
      dayStartMinute: 540,
      workweek: 62,
    })
    expect(createWorkCalendarSchema.parse({ name: 'Team' }).timezone).toBe('UTC')
  })

  it.each(['Mars/Olympus', 'GMT+25', '', 'not a zone'])('rejects the unknown zone %j', (tz) => {
    const result = createWorkCalendarSchema.safeParse({ name: 'x', timezone: tz })
    expect(result.success).toBe(false)
  })

  it('rejects an empty working week and out-of-range hours or day start', () => {
    expect(createWorkCalendarSchema.safeParse({ name: 'x', workweek: 0 }).success).toBe(false)
    expect(createWorkCalendarSchema.safeParse({ name: 'x', workweek: 128 }).success).toBe(false)
    expect(createWorkCalendarSchema.safeParse({ name: 'x', hoursPerDay: 0 }).success).toBe(false)
    expect(createWorkCalendarSchema.safeParse({ name: 'x', hoursPerDay: 25 }).success).toBe(false)
    expect(createWorkCalendarSchema.safeParse({ name: 'x', dayStartMinute: 1440 }).success).toBe(false)
  })

  it('update is partial but still validates what it is given', () => {
    expect(updateWorkCalendarSchema.parse({})).toEqual({})
    expect(updateWorkCalendarSchema.safeParse({ timezone: 'Nowhere/Here' }).success).toBe(false)
    expect(updateResourceSchema.parse({})).toEqual({})
  })

  it('an exception is a calendar day with optional hours and open minute', () => {
    expect(calendarExceptionSchema.parse({ day: '2026-12-25' })).toEqual({ day: '2026-12-25', isWorking: false })
    expect(calendarExceptionSchema.parse({ day: '2026-12-24', isWorking: true, hours: 4, startMinute: 780 })).toMatchObject({ hours: 4, startMinute: 780 })
    expect(calendarExceptionSchema.safeParse({ day: '25/12/2026' }).success).toBe(false)
    expect(calendarExceptionSchema.safeParse({ day: '2026-12-25', hours: 0 }).success).toBe(false)
  })
})

describe('resource schema', () => {
  it('enforces the kind ↔ identity rule from resources_kind_identity_check', () => {
    expect(createResourceSchema.safeParse({ kind: 'user', userId: UUID_A }).success).toBe(true)
    expect(createResourceSchema.safeParse({ kind: 'virtual', virtualMemberId: UUID_B }).success).toBe(true)
    expect(createResourceSchema.safeParse({ kind: 'agent', label: 'Claude' }).success).toBe(true)
    expect(createResourceSchema.safeParse({ kind: 'user' }).success).toBe(false)
    expect(createResourceSchema.safeParse({ kind: 'user', userId: UUID_A, virtualMemberId: UUID_B }).success).toBe(false)
    expect(createResourceSchema.safeParse({ kind: 'virtual', userId: UUID_A }).success).toBe(false)
    expect(createResourceSchema.safeParse({ kind: 'agent', userId: UUID_A }).success).toBe(false)
  })

  it('defaults one lane at full focus and bounds both', () => {
    expect(createResourceSchema.parse({ kind: 'agent' })).toMatchObject({ concurrency: 1, focusFactor: 1 })
    expect(createResourceSchema.safeParse({ kind: 'agent', concurrency: 0 }).success).toBe(false)
    expect(createResourceSchema.safeParse({ kind: 'agent', focusFactor: 0 }).success).toBe(false)
    expect(createResourceSchema.safeParse({ kind: 'agent', focusFactor: 1.5 }).success).toBe(false)
    expect(updateResourceSchema.safeParse({ concurrency: 2, focusFactor: 0.5 }).success).toBe(true)
  })
})
