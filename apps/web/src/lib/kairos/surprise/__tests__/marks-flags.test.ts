import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/surprise-marks', () => ({ openForUpdate: vi.fn(), listOpenMemoryIds: vi.fn() }))

import { openForUpdate } from '@/lib/data/surprise-marks'
import { isOpen, openMemories, openUntilFor, readSurpriseMark } from '../marks'
import {
  curiosityLpMode,
  surpriseContradictionsOn,
  surpriseCreditMode,
  surpriseGateMode,
  surpriseReplayMode,
  surpriseStageOn,
} from '../flag'

const iso = (s: string) => new Date(s)

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('openUntilFor — first 07:00Z at least 12h after `at`', () => {
  it.each([
    ['2026-10-03T09:30:00.000Z', '2026-10-04T07:00:00.000Z'], // BST day, morning
    ['2026-10-03T19:00:00.000Z', '2026-10-04T07:00:00.000Z'], // exactly 12h → same 07:00
    ['2026-10-03T19:00:00.001Z', '2026-10-05T07:00:00.000Z'], // just past → next day
    ['2026-10-03T23:30:00.000Z', '2026-10-05T07:00:00.000Z'], // night engine run
    ['2026-10-24T22:30:00.000Z', '2026-10-26T07:00:00.000Z'], // across BST→GMT (25 Oct)
    ['2026-03-28T18:30:00.000Z', '2026-03-29T07:00:00.000Z'], // across GMT→BST (29 Mar 01:00Z)
    ['2026-03-28T20:00:00.000Z', '2026-03-30T07:00:00.000Z'], // 12h lands 08:00Z → next day
    ['2026-12-31T18:00:00.000Z', '2027-01-01T07:00:00.000Z'], // year roll
  ])('%s → %s', (at, until) => {
    expect(openUntilFor(iso(at)).toISOString()).toBe(until)
  })
})

describe('isOpen / readSurpriseMark', () => {
  const NOW = iso('2026-10-03T09:30:00.000Z')
  const meta = (openUntil: unknown) => ({ belief: { status: 'held' }, engine: { outcome: { positive: 1 }, surprise: { openUntil, signals: [] } } })

  it('open strictly before openUntil, closed at/after it', () => {
    expect(isOpen(meta('2026-10-04T07:00:00.000Z'), NOW)).toBe(true)
    expect(isOpen(meta(NOW.toISOString()), NOW)).toBe(false)
    expect(isOpen(meta('2026-10-01T07:00:00.000Z'), NOW)).toBe(false)
  })

  it('tolerates missing or malformed marks', () => {
    for (const m of [null, undefined, 'x', [], {}, { engine: null }, { engine: { surprise: { openUntil: 5 } } }, meta('not-a-date')]) {
      expect(isOpen(m, NOW)).toBe(false)
    }
    expect(readSurpriseMark({ engine: {} })).toBeNull()
    expect(readSurpriseMark(meta('2026-10-04T07:00:00.000Z'))).toMatchObject({ openUntil: '2026-10-04T07:00:00.000Z' })
  })
})

describe('openMemories (best-effort)', () => {
  it('opens until openUntilFor(at) with the signal stamped at `at`', async () => {
    vi.mocked(openForUpdate).mockResolvedValue(['m1'])
    const at = iso('2026-10-03T09:30:00.000Z')
    expect(await openMemories('u1', ['m1'], { kind: 'promise_lapsed', ref: 'p1', s: 0.6 }, at)).toEqual(['m1'])
    expect(openForUpdate).toHaveBeenCalledWith('u1', ['m1'], { kind: 'promise_lapsed', ref: 'p1', s: 0.6, at: at.toISOString() }, openUntilFor(at))
  })

  it('never throws and skips empty input', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await openMemories('u1', [], { kind: 'aha', ref: 'x', s: 0.3 })).toEqual([])
    expect(openForUpdate).not.toHaveBeenCalled()
    vi.mocked(openForUpdate).mockRejectedValue(new Error('db'))
    expect(await openMemories('u1', ['m1'], { kind: 'aha', ref: 'x', s: 0.3 })).toEqual([])
  })
})

describe('flags (all default off)', () => {
  const tri = [
    ['KAIROS_SURPRISE_GATE', surpriseGateMode],
    ['KAIROS_SURPRISE_CREDIT', surpriseCreditMode],
    ['KAIROS_CURIOSITY_LP', curiosityLpMode],
    ['KAIROS_SURPRISE_REPLAY', surpriseReplayMode],
  ] as const

  it.each(tri)('%s: unset/0/junk → off, observe → observe, 1 → on', (name, read) => {
    vi.stubEnv(name, '')
    expect(read()).toBe('off')
    for (const [raw, mode] of [['0', 'off'], ['yes', 'off'], ['observe', 'observe'], [' OBSERVE ', 'observe'], ['1', 'on']] as const) {
      vi.stubEnv(name, raw)
      expect(read()).toBe(mode)
    }
  })

  it('KAIROS_SURPRISE_CONTRADICTIONS is binary (observe is off)', () => {
    vi.stubEnv('KAIROS_SURPRISE_CONTRADICTIONS', 'observe')
    expect(surpriseContradictionsOn()).toBe(false)
    vi.stubEnv('KAIROS_SURPRISE_CONTRADICTIONS', '1')
    expect(surpriseContradictionsOn()).toBe(true)
  })

  it('KAIROS_SURPRISE_STAGE is a no-op unless the stage is on or observing', () => {
    vi.stubEnv('KAIROS_SURPRISE_STAGE', '1')
    vi.stubEnv('KAIROS_STAGE', '0')
    expect(surpriseStageOn()).toBe(false)
    vi.stubEnv('KAIROS_STAGE', 'observe')
    expect(surpriseStageOn()).toBe(true)
    vi.stubEnv('KAIROS_STAGE', '1')
    expect(surpriseStageOn()).toBe(true)
    vi.stubEnv('KAIROS_SURPRISE_STAGE', '0')
    expect(surpriseStageOn()).toBe(false)
  })
})
