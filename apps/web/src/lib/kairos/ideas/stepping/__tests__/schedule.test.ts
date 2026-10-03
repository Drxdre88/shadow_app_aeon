import { afterEach, describe, expect, it, vi } from 'vitest'
import { noveltyEvery, noveltyMode, tasteMode } from '../flag'
import { isNoveltyNight, nextNoveltyNight, noveltyTonight, utcDayIndex } from '../schedule'

afterEach(() => vi.unstubAllEnvs())

describe('novelty schedule', () => {
  it('is fixed by the UTC date', () => {
    expect(isNoveltyNight('2026-10-04', 5)).toBe(true)
    expect(isNoveltyNight('2026-10-01', 5)).toBe(false)
    expect(isNoveltyNight(new Date('2026-10-04T23:59:00Z'), 5)).toBe(true)
    expect(isNoveltyNight(new Date('2026-10-05T00:00:00Z'), 5)).toBe(false)
    expect(isNoveltyNight('not-a-date', 5)).toBe(false)
  })

  it.each([2, 5, 7, 30])('has exactly one novelty night in any %i consecutive days', (every) => {
    const start = utcDayIndex('2026-01-01')!
    for (let offset = 0; offset < 60; offset++) {
      let hits = 0
      for (let d = 0; d < every; d++) {
        const day = new Date((start + offset + d) * 86_400_000)
        if (isNoveltyNight(day, every)) hits++
      }
      expect(hits).toBe(1)
    }
  })

  it('every 5 nights walks the weekday', () => {
    const weekdays = new Set<number>()
    let day = '2026-10-04'
    for (let i = 0; i < 7; i++) {
      weekdays.add(new Date(`${day}T00:00:00Z`).getUTCDay())
      day = nextNoveltyNight(new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000), 5)!
    }
    expect(weekdays.size).toBe(7)
  })

  it('nextNoveltyNight is today on a novelty night, else the next one', () => {
    expect(nextNoveltyNight('2026-10-04', 5)).toBe('2026-10-04')
    expect(nextNoveltyNight('2026-10-01', 5)).toBe('2026-10-04')
    expect(nextNoveltyNight('2026-10-05', 5)).toBe('2026-10-09')
    expect(nextNoveltyNight('junk', 5)).toBeNull()
  })
})

describe('flags', () => {
  it('default off', () => {
    vi.stubEnv('KAIROS_IDEA_NOVELTY', '')
    vi.stubEnv('KAIROS_IDEA_TASTE', '')
    vi.stubEnv('KAIROS_IDEA_NOVELTY_EVERY', '')
    expect(noveltyMode()).toBe('off')
    expect(tasteMode()).toBe('off')
    expect(noveltyEvery()).toBe(5)
    expect(noveltyTonight('2026-10-04')).toBe('off')
  })

  it('parses tri-state and clamps N to 2–30', () => {
    vi.stubEnv('KAIROS_IDEA_NOVELTY', 'observe')
    vi.stubEnv('KAIROS_IDEA_TASTE', 'ON')
    expect(noveltyMode()).toBe('observe')
    expect(tasteMode()).toBe('on')
    for (const [raw, want] of [['7', 7], ['2', 2], ['30', 30], ['1', 5], ['31', 5], ['3.5', 5], ['x', 5]] as const) {
      vi.stubEnv('KAIROS_IDEA_NOVELTY_EVERY', raw)
      expect(noveltyEvery()).toBe(want)
    }
  })

  it('noveltyTonight is the mode only on a novelty night', () => {
    vi.stubEnv('KAIROS_IDEA_NOVELTY', '1')
    vi.stubEnv('KAIROS_IDEA_NOVELTY_EVERY', '')
    expect(noveltyTonight('2026-10-04')).toBe('on')
    expect(noveltyTonight('2026-10-01')).toBe('off')
  })
})
