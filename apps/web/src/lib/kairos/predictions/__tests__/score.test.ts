import { describe, expect, it } from 'vitest'
import { metricsFor, scorePredictions, TRACK_RECORD_MIN_N } from '../score'
import { renderTrackRecordBlock, renderTrackRecordLine } from '../prompt-block'
import { NOW, prediction } from './fixtures'

const settled = (seq: number, status: 'right' | 'wrong' | 'void' | 'unresolved', probability = 0.8, over = {}) =>
  prediction(seq, { status, probability, settledAt: '2026-09-30T00:00:00.000Z', ...over })

describe('scorePredictions', () => {
  it('known Brier: 4 right + 1 wrong at p 0.8 → 0.16, perfectly calibrated', () => {
    const s = scorePredictions([1, 2, 3, 4].map((n) => settled(n, 'right')).concat(settled(5, 'wrong')), NOW)
    expect(s.overall).toMatchObject({ n: 5, right: 4, hitRate: 0.8, brier: 0.16, overconfidence: 0, meanProbability: 0.8 })
  })

  it('over-confidence = mean p − hit rate', () => {
    const m = metricsFor([settled(1, 'right', 0.9), settled(2, 'wrong', 0.9), settled(3, 'wrong', 0.6), settled(4, 'right', 0.6)])
    // brier = (0.01 + 0.81 + 0.36 + 0.16) / 4 = 0.335; mean p 0.75 − hit 0.5
    expect(m).toMatchObject({ brier: 0.335, overconfidence: 0.25 })
  })

  it('hides metrics until n >= 5; void / unresolved never count', () => {
    const four = [1, 2, 3, 4].map((n) => settled(n, 'right'))
    const s = scorePredictions([...four, settled(5, 'void'), settled(6, 'unresolved')], NOW)
    expect(TRACK_RECORD_MIN_N).toBe(5)
    expect(s).toEqual({ windowDays: 90, n: 4, overall: null, byDominion: [], byTopic: [] })
  })

  it('only the last 90 days count', () => {
    const old = [1, 2, 3, 4, 5].map((n) => settled(n, 'right', 0.8, { settledAt: '2026-06-01T00:00:00.000Z' }))
    expect(scorePredictions(old, NOW).n).toBe(0)
  })

  it('breakdowns appear only for groups with n >= 5', () => {
    const delivery = [1, 2, 3, 4, 5].map((n) => settled(n, 'right', 0.8, { topic: 'delivery', dominionId: 'dom-1' }))
    const risk = [6, 7].map((n) => settled(n, 'wrong', 0.7, { topic: 'risk', dominionId: 'dom-2' }))
    const s = scorePredictions([...delivery, ...risk], NOW)
    expect(s.byTopic.map((t) => [t.topic, t.n])).toEqual([['delivery', 5]])
    expect(s.byDominion.map((d) => [d.dominionId, d.n])).toEqual([['dom-1', 5]])
  })
})

describe('track record rendering', () => {
  it('below the threshold: block says too few, line is absent', () => {
    const s = scorePredictions([settled(1, 'right')], NOW)
    expect(renderTrackRecordBlock(s)).toContain('1 settled so far — too few')
    expect(renderTrackRecordLine(s)).toBeNull()
  })

  it('over-confident record earns an instruction; line is deterministic', () => {
    const s = scorePredictions([1, 2, 3].map((n) => settled(n, 'right', 0.9)).concat([4, 5].map((n) => settled(n, 'wrong', 0.9))), NOW)
    expect(renderTrackRecordBlock(s)).toContain('You have been over-confident')
    expect(renderTrackRecordLine(s)).toBe('Track record (90 days): 3 of 5 predictions right (60%) · Brier 0.33 · over-confidence +30 pts')
  })
})
