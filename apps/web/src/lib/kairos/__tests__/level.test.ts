import { describe, it, expect, afterEach } from 'vitest'
import { mindLevel, mindSwitch, levelSwitches, type MindLevel } from '../level'
import { predictionsEnabled } from '../predictions/flag'
import { initiativeEnabled } from '../initiative'
import { agendaEnabled } from '../agenda/flag'
import { gateMode } from '../moment/gate/flag'
import { trustMode } from '../trust/flag'
import { dreamsMode } from '../dreams/flag'
import { coldReadMode } from '../cold-read/flag'
import { livingDominionsMode } from '../living/flag'
import { surpriseContradictionsOn, surpriseGateMode } from '../surprise/flag'
import { cardTreeMode } from '../card-tree/flag'

const PARKED = [
  'KAIROS_GATE', 'KAIROS_GATE_RECEPTIVITY', 'KAIROS_READINESS', 'KAIROS_BIDS', 'KAIROS_REPAIR', 'KAIROS_ASK_FIRST',
  'KAIROS_TRUST', 'KAIROS_SURPRISE_GATE', 'KAIROS_SURPRISE_CREDIT', 'KAIROS_SURPRISE_REPLAY', 'KAIROS_CURIOSITY_LP',
]

const touched = ['KAIROS_LEVEL', 'KAIROS_PREDICTIONS', 'KAIROS_GATE', 'KAIROS_INITIATIVE', 'KAIROS_SURPRISE_CONTRADICTIONS', 'KAIROS_CARD_TREE', 'KAIROS_SURPRISE_GATE']

afterEach(() => {
  for (const k of touched) delete process.env[k]
})

const rank = (v: string | undefined) => (v === '1' ? 2 : v === 'observe' ? 1 : 0)

describe('KAIROS_LEVEL', () => {
  it('unset or junk means level 0: every switch off', () => {
    expect(mindLevel()).toBe(0)
    expect(mindSwitch('KAIROS_AI_DONE')).toBe('')
    process.env.KAIROS_LEVEL = 'lots'
    expect(mindLevel()).toBe(0)
    expect(predictionsEnabled()).toBe(false)
    expect(gateMode()).toBe('off')
  })

  it('level 1 starts the track record; the watch-only set is parked', () => {
    process.env.KAIROS_LEVEL = '1'
    expect(predictionsEnabled()).toBe(true)
    expect(gateMode()).toBe('off')
    expect(trustMode()).toBe('off')
    expect(surpriseGateMode()).toBe('off')
    expect(livingDominionsMode()).toBe('observe')
    expect(mindSwitch('KAIROS_IDEA_TASTE')).toBe('observe')
    expect(initiativeEnabled()).toBe(false)
    expect(dreamsMode()).toBe('off')
    expect(mindSwitch('KAIROS_REPO_MEMORY')).toBe('1')
    expect(mindSwitch('KAIROS_MISSION_CHECK')).toBe('1')
    expect(mindSwitch('KAIROS_AI_DONE')).toBe('1')
    expect(cardTreeMode()).toBe('on')
    for (const name of PARKED) expect(mindSwitch(name), name).toBe('')
  })

  it('a parked switch still turns on from its own env var at level 1', () => {
    process.env.KAIROS_LEVEL = '1'
    process.env.KAIROS_SURPRISE_GATE = 'observe'
    expect(surpriseGateMode()).toBe('observe')
  })

  it('level 2 restores the parked set in observe mode, gate live', () => {
    process.env.KAIROS_LEVEL = '2'
    expect(gateMode()).toBe('on')
    expect(trustMode()).toBe('observe')
    expect(surpriseGateMode()).toBe('observe')
    for (const name of PARKED.filter((n) => n !== 'KAIROS_GATE')) expect(mindSwitch(name), name).toBe('observe')
  })

  it('level 3 turns every parked switch live', () => {
    process.env.KAIROS_LEVEL = '3'
    for (const name of PARKED) expect(mindSwitch(name), name).toBe('1')
  })

  it('card trees are off below level 1 unless switched on directly', () => {
    expect(cardTreeMode()).toBe('off')
    process.env.KAIROS_CARD_TREE = 'on'
    expect(cardTreeMode()).toBe('on')
    process.env.KAIROS_LEVEL = '3'
    process.env.KAIROS_CARD_TREE = '0'
    expect(cardTreeMode()).toBe('off')
  })

  it('level 2 turns on initiative behind a live gate', () => {
    process.env.KAIROS_LEVEL = '2'
    expect(gateMode()).toBe('on')
    expect(initiativeEnabled()).toBe(true)
    expect(agendaEnabled()).toBe(true)
    expect(dreamsMode()).toBe('off')
  })

  it('card garden waits for level 2', () => {
    process.env.KAIROS_LEVEL = '1'
    expect(mindSwitch('KAIROS_CARD_GARDEN')).toBe('')
    process.env.KAIROS_LEVEL = '2'
    expect(mindSwitch('KAIROS_CARD_GARDEN')).toBe('1')
  })

  it('level 3 turns on the extras', () => {
    process.env.KAIROS_LEVEL = '3'
    expect(dreamsMode()).toBe('on')
    expect(coldReadMode()).toBe('speak')
    expect(livingDominionsMode()).toBe('on')
  })

  it('an explicit switch beats the level, including 0', () => {
    process.env.KAIROS_LEVEL = '2'
    process.env.KAIROS_INITIATIVE = '0'
    process.env.KAIROS_GATE = 'observe'
    expect(initiativeEnabled()).toBe(false)
    expect(gateMode()).toBe('observe')
    process.env.KAIROS_LEVEL = '0'
    process.env.KAIROS_PREDICTIONS = '1'
    expect(predictionsEnabled()).toBe(true)
  })

  it('never turns on conscience contradictions; that needs its own sign-off', () => {
    process.env.KAIROS_LEVEL = '3'
    expect(surpriseContradictionsOn()).toBe(false)
    expect(mindSwitch('KAIROS_SURPRISE_CONTRADICTIONS')).toBe('')
  })

  it('each level only adds or raises switches, never lowers one', () => {
    const levels: MindLevel[] = [0, 1, 2, 3]
    for (let i = 1; i < levels.length; i++) {
      const lower = levelSwitches(levels[i - 1])
      const higher = levelSwitches(levels[i])
      for (const [name, value] of Object.entries(lower)) {
        expect(rank(higher[name]), `${name} at level ${levels[i]}`).toBeGreaterThanOrEqual(rank(value))
      }
    }
  })
})
