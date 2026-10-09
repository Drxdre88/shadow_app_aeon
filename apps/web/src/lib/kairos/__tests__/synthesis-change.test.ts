import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/synthesis-change', () => ({
  latestArchetypeRunAt: vi.fn(),
  latestLiveCreatedAt: vi.fn(),
  countFreshInputs: vi.fn(),
  countArchetypeChangesSince: vi.fn(),
  countRowsCreatedSince: vi.fn(),
  dominionUpdatedAt: vi.fn(),
}))

import * as data from '@/lib/data/synthesis-change'
import { aetherChangeCheck, archetypeChangeCheck, cortexChangeCheck, decideRefresh, REFRESH_AFTER_DAYS } from '../synthesis-change'

const USER = 'user-1'
const DOM = 'dom-1'
const NOW = new Date('2026-10-09T02:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const daysAgo = (d: number) => hoursAgo(d * 24)

describe('decideRefresh', () => {
  it('runs on the first run, skips when nothing new arrived', () => {
    expect(decideRefresh({ lastOutputAt: null, newInputs: 0, now: NOW })).toEqual({ run: true, reason: 'first_run' })
    expect(decideRefresh({ lastOutputAt: hoursAgo(24), newInputs: 0, now: NOW })).toEqual({ run: false, reason: 'no_new_input' })
  })

  it('runs when new input arrived', () => {
    expect(decideRefresh({ lastOutputAt: hoursAgo(24), newInputs: 3, now: NOW })).toEqual({ run: true, reason: 'new_input' })
  })

  it('refreshes weekly even without new input', () => {
    expect(decideRefresh({ lastOutputAt: daysAgo(REFRESH_AFTER_DAYS), newInputs: 0, now: NOW })).toEqual({ run: true, reason: 'weekly_refresh' })
    expect(decideRefresh({ lastOutputAt: daysAgo(REFRESH_AFTER_DAYS - 0.1), newInputs: 0, now: NOW }).run).toBe(false)
  })

  it('runs when the Dominion itself was edited after the last output', () => {
    expect(decideRefresh({ lastOutputAt: hoursAgo(24), newInputs: 0, strategyChangedAt: hoursAgo(2), now: NOW }))
      .toEqual({ run: true, reason: 'strategy_changed' })
    expect(decideRefresh({ lastOutputAt: hoursAgo(24), newInputs: 0, strategyChangedAt: hoursAgo(30), now: NOW }).run).toBe(false)
  })
})

describe('archetypeChangeCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(data.countFreshInputs).mockResolvedValue(0)
    vi.mocked(data.dominionUpdatedAt).mockResolvedValue(daysAgo(30))
  })

  it('skips a Dominion with no new memory since its last run', async () => {
    vi.mocked(data.latestArchetypeRunAt).mockResolvedValue(hoursAgo(24))
    expect(await archetypeChangeCheck(USER, DOM, NOW)).toEqual({ run: false, reason: 'no_new_input' })
    expect(data.countFreshInputs).toHaveBeenCalledWith(USER, DOM, hoursAgo(24))
  })

  it('runs when a new memory arrived', async () => {
    vi.mocked(data.latestArchetypeRunAt).mockResolvedValue(hoursAgo(24))
    vi.mocked(data.countFreshInputs).mockResolvedValue(2)
    expect(await archetypeChangeCheck(USER, DOM, NOW)).toEqual({ run: true, reason: 'new_input' })
  })

  it('runs a week-old set without counting inputs', async () => {
    vi.mocked(data.latestArchetypeRunAt).mockResolvedValue(daysAgo(8))
    expect(await archetypeChangeCheck(USER, DOM, NOW)).toEqual({ run: true, reason: 'weekly_refresh' })
    expect(data.countFreshInputs).not.toHaveBeenCalled()
  })

  it('runs the first time', async () => {
    vi.mocked(data.latestArchetypeRunAt).mockResolvedValue(null)
    expect(await archetypeChangeCheck(USER, DOM, NOW)).toEqual({ run: true, reason: 'first_run' })
  })
})

describe('cortexChangeCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(data.latestLiveCreatedAt).mockResolvedValue(hoursAgo(23))
    vi.mocked(data.countFreshInputs).mockResolvedValue(0)
    vi.mocked(data.countArchetypeChangesSince).mockResolvedValue(0)
    vi.mocked(data.dominionUpdatedAt).mockResolvedValue(daysAgo(30))
  })

  it('skips when neither memories nor archetypes changed', async () => {
    expect(await cortexChangeCheck(USER, DOM, NOW)).toEqual({ run: false, reason: 'no_new_input' })
    expect(data.latestLiveCreatedAt).toHaveBeenCalledWith(USER, 'cortex', DOM)
  })

  it('runs when an archetype was revised, added or archived since the cortex', async () => {
    vi.mocked(data.countArchetypeChangesSince).mockResolvedValue(1)
    expect(await cortexChangeCheck(USER, DOM, NOW)).toEqual({ run: true, reason: 'new_input' })
  })
})

describe('aetherChangeCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(data.latestLiveCreatedAt).mockResolvedValue(hoursAgo(23))
  })

  it('skips when no cortex was written since the live aether', async () => {
    vi.mocked(data.countRowsCreatedSince).mockResolvedValue(0)
    expect(await aetherChangeCheck(USER, NOW)).toEqual({ run: false, reason: 'no_new_input' })
    expect(data.countRowsCreatedSince).toHaveBeenCalledWith(USER, 'cortex', hoursAgo(23))
  })

  it('runs when a cortex was written since', async () => {
    vi.mocked(data.countRowsCreatedSince).mockResolvedValue(1)
    expect((await aetherChangeCheck(USER, NOW)).run).toBe(true)
  })

  it('refreshes a week-old aether regardless', async () => {
    vi.mocked(data.latestLiveCreatedAt).mockResolvedValue(daysAgo(7))
    expect(await aetherChangeCheck(USER, NOW)).toEqual({ run: true, reason: 'weekly_refresh' })
  })
})
