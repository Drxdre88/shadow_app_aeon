import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_WINDOW_UTC,
  BRIEF_WINDOW_UTC,
  CHAT_DISTILL_WINDOW_UTC,
  currentMicroSlot,
  minutesLeftInWindow,
} from '../deadlines'

const at = (iso: string) => new Date(iso)

describe('minutesLeftInWindow', () => {
  it('is 0 before the window opens and after it closes', () => {
    expect(minutesLeftInWindow(at('2026-10-01T00:59:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(0)
    expect(minutesLeftInWindow(at('2026-10-01T01:58:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(0)
    expect(minutesLeftInWindow(at('2026-10-01T06:20:00Z'), BRIEF_WINDOW_UTC)).toBeLessThanOrEqual(0)
  })

  it('counts down to the deadline inside the window', () => {
    expect(minutesLeftInWindow(at('2026-10-01T01:40:00Z'), CHAT_DISTILL_WINDOW_UTC)).toBe(18)
    expect(minutesLeftInWindow(at('2026-10-01T01:40:30Z'), ARCHETYPE_WINDOW_UTC)).toBe(47.5)
  })

  it('every window closes two minutes before its fallback cron', () => {
    expect(CHAT_DISTILL_WINDOW_UTC.deadline).toEqual({ hour: 1, minute: 58 })
    expect(ARCHETYPE_WINDOW_UTC.deadline).toEqual({ hour: 2, minute: 28 })
    expect(BRIEF_WINDOW_UTC.deadline).toEqual({ hour: 6, minute: 13 })
  })
})

describe('currentMicroSlot', () => {
  it('opens an hour before a slot and closes two minutes before it', () => {
    expect(currentMicroSlot(at('2026-10-01T08:14:00Z'))).toBeNull()
    const s = currentMicroSlot(at('2026-10-01T09:05:00Z'))
    expect(s?.slot.toISOString()).toBe('2026-10-01T09:15:00.000Z')
    expect(s?.deadline.toISOString()).toBe('2026-10-01T09:13:00.000Z')
    expect(currentMicroSlot(at('2026-10-01T09:13:00Z'))).toBeNull()
  })

  it('serves the 06:15 slot from the 05:40 morning routine and has no slot at 03:00', () => {
    expect(currentMicroSlot(at('2026-10-01T05:40:00Z'))?.slot.toISOString()).toBe('2026-10-01T06:15:00.000Z')
    expect(currentMicroSlot(at('2026-10-01T03:00:00Z'))).toBeNull()
  })
})
