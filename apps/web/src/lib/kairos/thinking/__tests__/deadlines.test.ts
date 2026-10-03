import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_WINDOW_UTC,
  ASK_MINE_WINDOW_UTC,
  CHAT_DISTILL_WINDOW_UTC,
  PULSE_WINDOW_LONDON,
  REFLECT_WINDOW_LONDON,
  daytimeSlotKey,
  inLondonHours,
  londonDayStart,
  minutesLeftInWindow,
} from '../deadlines'

const at = (iso: string) => new Date(iso)

describe('minutesLeftInWindow', () => {
  it('is 0 before the window opens and after it closes', () => {
    expect(minutesLeftInWindow(at('2026-10-01T00:59:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(0)
    expect(minutesLeftInWindow(at('2026-10-01T01:58:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(0)
    expect(minutesLeftInWindow(at('2026-10-01T05:00:00Z'), ASK_MINE_WINDOW_UTC)).toBeLessThanOrEqual(0)
  })

  it('counts down to the deadline inside the window', () => {
    expect(minutesLeftInWindow(at('2026-10-01T01:40:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(18)
    expect(minutesLeftInWindow(at('2026-10-01T01:40:30Z'), ARCHETYPE_WINDOW_UTC)).toBe(47.5)
  })

  it('every window closes two minutes before its fallback cron', () => {
    expect(CHAT_DISTILL_WINDOW_UTC.deadline).toEqual({ hour: 1, minute: 58 })
    expect(ARCHETYPE_WINDOW_UTC.deadline).toEqual({ hour: 2, minute: 28 })
    expect(ASK_MINE_WINDOW_UTC.deadline).toEqual({ hour: 4, minute: 28 })
  })
})

describe('daytime slots (London hours, clock-change safe)', () => {
  it('keys one slot per kind per London hour, in summer and winter time', () => {
    expect(daytimeSlotKey('pulse', at('2026-10-01T10:10:00Z'))).toBe('pulse:2026-10-01:11')
    expect(daytimeSlotKey('reflect', at('2026-12-01T10:40:00Z'))).toBe('reflect:2026-12-01:10')
    // 23:30Z in BST is already tomorrow 00:30 London.
    expect(daytimeSlotKey('pulse', at('2026-06-30T23:30:00Z'))).toBe('pulse:2026-07-01:00')
  })

  it('windows are inclusive London hours', () => {
    expect(inLondonHours(at('2026-10-01T06:10:00Z'), PULSE_WINDOW_LONDON)).toBe(true) // 07:10 BST
    expect(inLondonHours(at('2026-12-01T06:10:00Z'), PULSE_WINDOW_LONDON)).toBe(false) // 06:10 GMT
    expect(inLondonHours(at('2026-10-01T21:10:00Z'), PULSE_WINDOW_LONDON)).toBe(true) // 22:10 BST
    expect(inLondonHours(at('2026-10-01T21:10:00Z'), REFLECT_WINDOW_LONDON)).toBe(false)
    expect(inLondonHours(at('2026-10-01T07:40:00Z'), REFLECT_WINDOW_LONDON)).toBe(true) // 08:40 BST
  })

  it('londonDayStart is 00:00 London', () => {
    expect(londonDayStart(at('2026-10-01T10:00:00Z')).toISOString()).toBe('2026-09-30T23:00:00.000Z')
    expect(londonDayStart(at('2026-12-01T10:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })
})
