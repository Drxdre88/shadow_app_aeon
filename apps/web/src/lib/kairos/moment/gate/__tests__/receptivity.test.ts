import { describe, expect, it } from 'vitest'
import { emptyGateState, emptyReceptivity, foldObservations, isColdHour, isColdNow, londonSlot, sourceOf, attachLogMemoryId, appendGateLog, type GateObservation } from '../receptivity'
import { replyWarmth, isBrushOff } from '../reply-tone'
import { buildObservation } from '../fold'
import { GATE_LOG_MAX } from '@/lib/data/validators/kairos-gate'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const obs = (sentAt: string, replied: boolean, extra: Partial<GateObservation> = {}): GateObservation => ({
  memoryId: sentAt, sentAt: new Date(sentAt), replied, latencyMin: replied ? 30 : null, warmth: null, replyChannel: replied ? 'telegram' : null,
  kind: 'notify', source: 'agenda', breakType: 'immediate', ...extra,
})

describe('receptivity fold', () => {
  it('folds observations into London hour/day, kind, source, break and channel cells', () => {
    const rec = foldObservations(emptyReceptivity(), [obs('2026-10-03T08:30:00.000Z', true)], new Date('2026-10-03T12:00:00.000Z'), NOW)
    expect(rec.global).toEqual({ n: 1, replied: 1, latSum: 30, latN: 1, warmSum: 0, warmN: 0 })
    expect(rec.hour['9']).toMatchObject({ n: 1, replied: 1 }) // 08:30Z = 09:30 BST
    expect(rec.dow['6']).toMatchObject({ n: 1 }) // Saturday
    expect(rec.source.agenda).toMatchObject({ n: 1 })
    expect(rec.replyChannel).toEqual({ telegram: 1 })
    expect(rec.foldedThrough).toBe('2026-10-03T12:00:00.000Z')
  })

  it('is idempotent through the watermark', () => {
    const through = new Date('2026-10-03T12:00:00.000Z')
    const once = foldObservations(emptyReceptivity(), [obs('2026-10-03T08:30:00.000Z', true)], through, NOW)
    expect(foldObservations(once, [obs('2026-10-03T08:30:00.000Z', true)], through, NOW)).toBe(once)
    const later = foldObservations(once, [obs('2026-10-03T08:30:00.000Z', true), obs('2026-10-03T13:00:00.000Z', false)], new Date('2026-10-03T14:00:00.000Z'), NOW)
    expect(later.global.n).toBe(2)
  })

  it('decays older evidence with a 28-day half-life', () => {
    const base = foldObservations(emptyReceptivity(), [obs('2026-09-01T08:30:00.000Z', true)], new Date('2026-09-01T12:00:00.000Z'), new Date('2026-09-02T12:00:00.000Z'))
    const next = foldObservations(base, [], new Date('2026-09-30T12:00:00.000Z'), new Date('2026-09-30T12:00:00.000Z'))
    expect(next.global.n).toBeCloseTo(0.5, 3)
  })

  it('a cold hour needs evidence and a smoothed rate under half the global rate', () => {
    const rec = emptyReceptivity()
    rec.global = { n: 40, replied: 24, latSum: 0, latN: 0, warmSum: 0, warmN: 0 }
    rec.hour['22'] = { n: 8, replied: 0, latSum: 0, latN: 0, warmSum: 0, warmN: 0 }
    rec.hour['23'] = { n: 3, replied: 0, latSum: 0, latN: 0, warmSum: 0, warmN: 0 }
    rec.hour['9'] = { n: 8, replied: 6, latSum: 0, latN: 0, warmSum: 0, warmN: 0 }
    expect(isColdHour(rec, 22)).toBe(true)
    expect(isColdHour(rec, 23)).toBe(false)
    expect(isColdHour(rec, 9)).toBe(false)
    expect(isColdNow(rec, new Date('2026-10-04T21:30:00.000Z'))).toBe(true) // 22:30 BST
    expect(isColdHour(emptyReceptivity(), 22)).toBe(false)
  })

  it('London slot follows BST/GMT', () => {
    expect(londonSlot(new Date('2026-07-01T23:30:00.000Z'))).toEqual({ hour: 0, dow: 4 })
    expect(londonSlot(new Date('2026-12-01T23:30:00.000Z'))).toEqual({ hour: 23, dow: 2 })
  })

  it('classifies the speak source from its externalId', () => {
    expect(sourceOf('kairos-agenda:1')).toBe('agenda')
    expect(sourceOf('kairos-promise-nudge:p')).toBe('promise')
    expect(sourceOf('cold-read:j')).toBe('cold_read')
    expect(sourceOf('kairos-daily:2026-10-04')).toBe('daily')
    expect(sourceOf('weekly-review:2026-W40')).toBe('weekly')
    expect(sourceOf(undefined)).toBe('external')
  })
})

describe('decision log', () => {
  it('keeps the newest entries and attaches the memory id of a same-instant decision', () => {
    let state = emptyGateState()
    for (let i = 0; i < GATE_LOG_MAX + 5; i++) state = appendGateLog(state, [{ at: `t${i}`, memoryId: null, mode: 'on', decision: 'send', reason: 'quiet' }])
    expect(state.log).toHaveLength(GATE_LOG_MAX)
    expect(state.log[0]!.at).toBe('t5')
    const attached = attachLogMemoryId(state, `t${GATE_LOG_MAX + 4}`, 'm-1')
    expect(attached?.log.at(-1)).toMatchObject({ memoryId: 'm-1' })
    expect(attachLogMemoryId(state, 'nope', 'm-1')).toBeNull()
  })
})

describe('buildObservation', () => {
  const credit = (o: { createdAt: Date; sourceMetadata: unknown }) => {
    const m = o.sourceMetadata as Record<string, unknown>
    return m.status === 'replied' && Date.parse(String(m.repliedAt)) - o.createdAt.getTime() <= 86_400_000
  }

  it('uses the release time as the send time and the first owner entry for latency, channel and warmth', () => {
    const o = buildObservation(
      { id: 'm1', createdAt: new Date('2026-10-03T08:00:00.000Z'), sourceMetadata: { status: 'replied', repliedAt: '2026-10-03T10:00:00.000Z', kind: 'question', externalId: 'cold-read:x', gate: { releasedAt: '2026-10-03T09:00:00.000Z', releaseReason: 'card_closed' } } },
      [{ at: '2026-10-03T09:20:00.000Z', channel: 'telegram', type: 'said', speaker: 'owner', relayed: false, text: 'thanks!' }],
      [],
      credit,
    )
    expect(o).toMatchObject({ replied: true, latencyMin: 20, replyChannel: 'telegram', kind: 'question', source: 'cold_read', breakType: 'card_closed' })
    expect(o.sentAt.toISOString()).toBe('2026-10-03T09:00:00.000Z')
    expect(o.warmth).toBeGreaterThan(0)
  })

  it('takes the break type from the decision log and defaults to immediate', () => {
    const row = { id: 'm2', createdAt: new Date('2026-10-03T08:00:00.000Z'), sourceMetadata: { status: 'pending' } }
    expect(buildObservation(row, [], [{ at: 'x', memoryId: 'm2', mode: 'observe', decision: 'hold', reason: 'busy' }], credit).breakType).toBe('busy')
    expect(buildObservation(row, [], [], credit)).toMatchObject({ breakType: 'immediate', replied: false, warmth: null, replyChannel: null })
  })
})

describe('reply tone', () => {
  it.each([
    ['thanks, that helps!', 1],
    ['haha nice 👍', 1],
    ['not now', -1],
    ['ok', -1],
    ['', 0],
    ['I moved the card', 0],
  ])('%s', (text, sign) => {
    expect(Math.sign(replyWarmth(text))).toBe(sign)
  })

  it('stays within [-1, 1] and spots brush-offs', () => {
    expect(replyWarmth('stop, not now, later, busy, go away')).toBe(-1)
    expect(isBrushOff('later please')).toBe(true)
    expect(isBrushOff('thanks')).toBe(false)
  })
})
