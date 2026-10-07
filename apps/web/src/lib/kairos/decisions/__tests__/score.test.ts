import { describe, expect, it } from 'vitest'
import type { KairosDecision } from '@/lib/data/validators/kairos-decisions'
import { calibrateDecisions, countsTowardCalibration } from '../score'
import { calibrationLines, calibrationSentence, renderDecisionsMarkdown } from '../render'
import { confirmInState, discardInState, emptyDecisionsState, logInState, settleInState, sortOpenDecisions, toDecisionView } from '../journal'
import { decisionTypeLabel, normalizeDecisionType } from '../types'

let n = 0
function decision(over: Partial<KairosDecision> = {}): KairosDecision {
  n++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    seq: n,
    decision: 'Hire a designer',
    expectation: 'ships the new site',
    probability: 0.8,
    decisionType: 'hire',
    checkBy: '2026-11-01',
    origin: { kind: 'owner', via: 'app' },
    createdAt: '2026-10-01T09:00:00.000Z',
    status: 'right',
    settledAt: '2026-11-01T09:00:00.000Z',
    settledVia: 'app',
    ...over,
  }
}

const NOW = new Date('2026-10-07T09:00:00.000Z')

describe('calibrateDecisions', () => {
  it('groups by decision type and shows a read once a type has 3 settled', () => {
    const closed = [
      ...[1, 2, 3, 4].map(() => decision()),
      decision({ status: 'wrong' }),
      decision({ decisionType: 'project', probability: 0.6 }),
      decision({ decisionType: 'project', probability: 0.6, status: 'wrong' }),
    ]
    const cal = calibrateDecisions(closed)
    expect(cal.settled).toBe(7)
    expect(cal.byType).toHaveLength(1)
    expect(cal.byType[0]).toMatchObject({ decisionType: 'hire', label: 'Hiring calls', n: 5, right: 4, hitRate: 0.8, meanProbability: 0.8 })
    expect(cal.building).toEqual([{ decisionType: 'project', label: 'Project bets', n: 2 }])
    expect(calibrationSentence(cal.byType[0]!)).toBe('Hiring calls: 4 of 5 right when you were 80% sure — about as sure as you should be')
    expect(calibrationLines(cal)[1]).toBe('Project bets: 2 settled so far — 1 more before a read')
  })

  it('never counts void or unconfirmed relayed decisions', () => {
    const relayed = { kind: 'relayed', via: 'mcp' } as const
    expect(countsTowardCalibration(decision({ status: 'void' }))).toBe(false)
    expect(countsTowardCalibration(decision({ origin: relayed }))).toBe(false)
    expect(countsTowardCalibration(decision({ origin: relayed, confirmedAt: '2026-10-02T00:00:00.000Z' }))).toBe(true)
    const cal = calibrateDecisions([decision(), decision(), decision({ origin: relayed, status: 'wrong' }), decision({ status: 'void' })])
    expect(cal.settled).toBe(2)
    expect(cal.byType).toEqual([])
  })

  it('names over-confidence in plain words', () => {
    const cal = calibrateDecisions([decision({ probability: 0.9 }), decision({ probability: 0.9, status: 'wrong' }), decision({ probability: 0.9, status: 'wrong' })])
    expect(calibrationSentence(cal.byType[0]!)).toBe('Hiring calls: 1 of 3 right when you were 90% sure — you tend to be over-sure')
  })
})

describe('journal steps', () => {
  const input = { decision: 'Back Hydra', expectation: 'three paying users', probability: 0.7, decisionType: 'Which project', checkBy: '2026-10-20' }

  it('numbers D1, D2 and normalises preset types', () => {
    const a = logInState(emptyDecisionsState(), input, { kind: 'owner', via: 'app' }, '00000000-0000-4000-8000-0000000000a1', NOW)
    if (!a.ok) throw new Error('log failed')
    const b = logInState(a.state, { ...input, decisionType: 'Pricing' }, { kind: 'owner', via: 'app' }, '00000000-0000-4000-8000-0000000000a2', NOW)
    if (!b.ok) throw new Error('log failed')
    expect([a.decision.seq, b.decision.seq, b.state.nextSeq]).toEqual([1, 2, 3])
    expect(a.decision.decisionType).toBe('project')
    expect(b.decision.decisionType).toBe('pricing')
    expect(decisionTypeLabel('pricing')).toBe('Pricing calls')
    expect(normalizeDecisionType(' Hiring ')).toBe('hire')
  })

  it('refuses a check-by date in the past (London)', () => {
    expect(logInState(emptyDecisionsState(), { ...input, checkBy: '2026-10-06' }, { kind: 'owner', via: 'app' }, 'x', NOW)).toEqual({ ok: false, reason: 'past_check_by' })
  })

  it('confirm and discard only apply to unconfirmed relayed entries', () => {
    const relayed = decision({ status: 'open', origin: { kind: 'relayed', via: 'rest' }, settledAt: undefined, settledVia: undefined })
    const mine = decision({ status: 'open', settledAt: undefined, settledVia: undefined })
    const state = { ...emptyDecisionsState(), open: [relayed, mine] }
    expect(settleInState(state, relayed.id, 'right', 'app', NOW)).toEqual({ ok: false, reason: 'unconfirmed' })
    expect(confirmInState(state, mine.id, NOW)).toEqual({ ok: false, reason: 'not_relayed' })
    const gone = discardInState(state, relayed.id)
    expect(gone.ok && gone.state.open.map((d) => d.id)).toEqual([mine.id])
  })

  it('sorts open decisions due first and flags due ones', () => {
    const later = decision({ status: 'open', checkBy: '2026-12-01' })
    const due = decision({ status: 'open', checkBy: '2026-10-07' })
    const sorted = sortOpenDecisions([later, due])
    expect(sorted.map((d) => d.id)).toEqual([due.id, later.id])
    expect(toDecisionView(due, NOW)).toMatchObject({ due: true, number: `D${due.seq}` })
    expect(toDecisionView(later, NOW).due).toBe(false)
  })

  it('renders the journal as markdown with the relayed prompt', () => {
    const relayed = toDecisionView(decision({ status: 'open', origin: { kind: 'relayed', via: 'mcp' } }), NOW)
    const md = renderDecisionsMarkdown({ decisions: [relayed], calibration: calibrateDecisions([]) })
    expect(md).toContain('relayed, confirm?')
    expect(md).toContain('Nothing settled yet')
  })
})
