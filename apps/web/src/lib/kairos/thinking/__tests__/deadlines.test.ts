import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_WINDOW_UTC,
  ASK_MINE_WINDOW_UTC,
  CHAT_DISTILL_WINDOW_UTC,
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
