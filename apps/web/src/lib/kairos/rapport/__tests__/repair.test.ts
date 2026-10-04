import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { kairosRapportSchema } from '@/lib/data/validators/kairos-rapport'
import {
  REPAIR_MIN_GAP_MS,
  advanceRupture,
  emptyRupture,
  markRepaired,
  onOwnerMessage,
  recordNotNow,
  recordSoft,
  repairOpening,
} from '../repair'
import { applyOwnerTurn, emptyRapport, pruneRapport } from '../state'
import type { RapportModes } from '../flag'

const T0 = new Date('2026-10-01T09:00:00.000Z')
const h = (hours: number) => new Date(T0.getTime() + hours * 3_600_000)
const soft = (kind: 'ignored' | 'dismissed' | 'terse', ref: string, when: Date) => ({ at: when.toISOString(), kind, ref })
const ALL_ON: RapportModes = { readiness: 'on', bids: 'on', repair: 'on' }

describe('rupture state machine', () => {
  it('"not now" backs off at once; cooldown → repair owed; delivery → repaired; owner message → steady', () => {
    let r = recordNotNow(emptyRupture(T0), 'not now', T0)
    expect(r).toMatchObject({ state: 'backing_off', reason: 'not_now', trigger: 'not now', cooldownH: 24 })
    expect(advanceRupture(r, h(23), null).state).toBe('backing_off')
    r = advanceRupture(r, h(25), null)
    expect(r.state).toBe('repair_owed')
    r = markRepaired(r, 'daily', h(26))
    expect(r).toMatchObject({ state: 'repaired', via: 'daily', lastRepairAt: h(26).toISOString() })
    r = onOwnerMessage(r, h(27))
    expect(r).toMatchObject({ state: 'steady', cooldownH: 24, soft: [] })
  })

  it('needs two distinct soft signals within 72h', () => {
    let r = recordSoft(emptyRupture(T0), soft('dismissed', 'd1', T0), T0)
    expect(r.state).toBe('steady')
    r = recordSoft(r, soft('dismissed', 'd1', h(1)), h(1))
    expect(r.state).toBe('steady')
    const late = recordSoft(r, soft('ignored', 'i1', h(80)), h(80))
    expect(late.state).toBe('steady')
    r = recordSoft(r, soft('ignored', 'i1', h(2)), h(2))
    expect(r).toMatchObject({ state: 'backing_off', reason: 'ignored' })
  })

  it('a 06:00 repair met by 48h of silence backs off again with the cooldown doubled', () => {
    const owed = advanceRupture(recordNotNow(emptyRupture(T0), 'stop', T0), h(25), null)
    const repaired = markRepaired(owed, 'daily', h(26))
    const r = advanceRupture(repaired, h(26 + 49), T0.toISOString())
    expect(r).toMatchObject({ state: 'backing_off', cooldownH: 48 })
    expect(advanceRupture(repaired, h(26 + 49), h(30).toISOString()).state).toBe('repaired')
  })

  it('a chat repair settles to steady after 72h', () => {
    const repaired = markRepaired(recordNotNow(emptyRupture(T0), 'later', T0), 'chat', h(1))
    expect(advanceRupture(repaired, h(74), null).state).toBe('steady')
  })

  it('at most one repair per 7 days', () => {
    const repaired = markRepaired(recordNotNow(emptyRupture(T0), 'stop', T0), 'chat', h(1))
    const again = recordNotNow(onOwnerMessage(repaired, h(2)), 'stop', h(3))
    expect(advanceRupture(again, h(3 + 30), null).state).toBe('backing_off')
    expect(advanceRupture(again, new Date(h(1).getTime() + REPAIR_MIN_GAP_MS), null).state).toBe('repair_owed')
  })

  it('cooldown never exceeds 168h', () => {
    let r = recordNotNow(emptyRupture(T0), 'stop', T0)
    for (let i = 0; i < 6; i++) r = recordNotNow(markRepaired(r, 'chat', T0), 'stop', T0)
    expect(r.cooldownH).toBe(168)
  })

  it('repair openings name it, own it and ask exactly one question', () => {
    for (const reason of ['not_now', 'ignored', 'dismissed', 'terse'] as const) {
      const line = repairOpening({ reason, trigger: 'not now, I am slammed' })
      expect(line).toMatch(/on me/)
      expect(line.split('?').length - 1).toBe(1)
      expect(line.trim().endsWith('?')).toBe(true)
    }
    expect(repairOpening({ reason: 'not_now', trigger: 'not now' })).toContain('“not now”')
  })
})

describe('applyOwnerTurn', () => {
  const objectives = [{ id: 'o1', title: 'Run a marathon' }, { id: 'o2', title: 'Ship the Aeon beta' }]

  it('records bid, not-now and readiness only for the flags that are set', () => {
    const s = emptyRapport(T0)
    const off: RapportModes = { readiness: 'off', bids: 'off', repair: 'off' }
    const none = applyOwnerTurn(s, { ref: 'chat:t:1', body: 'not now', at: T0, modes: off, objectives })
    expect(none.effects).toEqual({ tip: null, bid: null, notNow: false, terse: false })
    expect(none.state.rupture.state).toBe('steady')
    const live = applyOwnerTurn(s, { ref: 'chat:t:1', body: 'not now', at: T0, modes: ALL_ON, objectives })
    expect(live.effects.notNow).toBe(true)
    expect(live.state.rupture.state).toBe('backing_off')
  })

  it('matches change talk to an owner goal; unmatched talk is dropped', () => {
    const s = emptyRapport(T0)
    const hit = applyOwnerTurn(s, { ref: 'chat:t:1', body: "I'll sign up for the marathon", at: T0, modes: ALL_ON, objectives })
    expect(hit.effects.tip).toMatchObject({ kind: 'commit', objectiveId: 'o1', title: 'Run a marathon' })
    expect(Object.keys(hit.state.goals)).toEqual(['o1'])
    const miss = applyOwnerTurn(s, { ref: 'chat:t:2', body: "I'll call the plumber", at: T0, modes: ALL_ON, objectives })
    expect(miss.effects.tip).toBeNull()
    expect(miss.state.goals).toEqual({})
  })

  it('a terse run against a chatty baseline is one soft signal', () => {
    let s = emptyRapport(T0)
    for (let i = 0; i < 12; i++) s = applyOwnerTurn(s, { ref: `chat:t:${i}`, body: 'here is a long and thoughtful message about plans', at: h(i), modes: ALL_ON, objectives: [] }).state
    const signals: boolean[] = []
    for (let i = 12; i < 16; i++) {
      const out = applyOwnerTurn(s, { ref: `chat:t:${i}`, body: 'ok', at: h(i), modes: ALL_ON, objectives: [] })
      signals.push(out.effects.terse)
      s = out.state
    }
    expect(signals).toEqual([false, false, true, false])
    expect(s.rupture.soft).toHaveLength(1)
  })

  test.prop([fc.array(fc.string({ maxLength: 120 }), { maxLength: 40 })])('any sequence of turns keeps a schema-valid state', (bodies) => {
    let s = emptyRapport(T0)
    bodies.forEach((body, i) => {
      s = pruneRapport(applyOwnerTurn(s, { ref: `chat:t:${i}`, body, at: h(i), modes: ALL_ON, objectives }).state, h(i))
    })
    expect(kairosRapportSchema.safeParse(s).success).toBe(true)
  })
})
