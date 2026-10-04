import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { KairosGateCorruptError, parseKairosGate, toKairosGateView } from '@/lib/data/kairos-gate'
import { kairosGateViewSchema } from '@/lib/data/validators/kairos-gate'
import { emptyGateState, foldObservations } from '../receptivity'
import { renderGateMarkdown } from '../render'

afterEach(() => { delete process.env.KAIROS_GATE })

describe('kairosGate preference', () => {
  it('missing → empty state; corrupt → throws so no writer clobbers it', () => {
    expect(parseKairosGate(undefined)).toEqual(emptyGateState())
    expect(() => parseKairosGate({ v: 2 })).toThrow(KairosGateCorruptError)
    expect(() => parseKairosGate({ ...emptyGateState(), extra: 1 })).toThrow(KairosGateCorruptError)
  })
})

describe('toKairosGateView', () => {
  it('summarises held rows (no bodies), the map and the newest log first; renders markdown', () => {
    process.env.KAIROS_GATE = 'observe'
    const state = emptyGateState()
    state.receptivity = foldObservations(state.receptivity, [{
      memoryId: 'm', sentAt: new Date('2026-10-03T08:30:00.000Z'), replied: true, latencyMin: 12, warmth: 0.5,
      replyChannel: 'web', kind: 'notify', source: 'agenda', breakType: 'quiet',
    }], new Date('2026-10-03T12:00:00.000Z'), new Date('2026-10-04T12:00:00.000Z'))
    state.log = [
      { at: '2026-10-04T10:00:00.000Z', memoryId: null, mode: 'observe', decision: 'hold', reason: 'busy' },
      { at: '2026-10-04T11:00:00.000Z', memoryId: 'm', mode: 'observe', decision: 'send', reason: 'idle' },
    ]
    const held = [{ id: 'h1', title: 'Agenda', bodyMd: 'secret body', createdAt: new Date(), sourceMetadata: { gate: { heldAt: 'a', until: 'b', reason: 'busy' } } }]
    const view = toKairosGateView(state, held)
    expect(kairosGateViewSchema.parse(view)).toEqual(view)
    expect(view.mode).toBe('observe')
    expect(view.held).toEqual([{ id: 'h1', title: 'Agenda', heldAt: 'a', until: 'b', reason: 'busy' }])
    expect(JSON.stringify(view)).not.toContain('secret body')
    expect(view.receptivity.hours).toEqual([{ hour: 9, n: 1, replyRate: 1, avgLatencyMin: 12, warmth: 0.5, cold: false }])
    expect(view.log[0]!.reason).toBe('idle')
    const md = renderGateMarkdown(view)
    expect(md).toContain('# Kairos gate')
    expect(md).toContain('Agenda')
    expect(md).toContain('09:00: n 1, replied 100%')
  })
})
