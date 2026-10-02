import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import type { GoalCandidate } from '../parse'
import { checkGoalPolicy, GOAL_NOVELTY_COSINE, type GoalPolicyContext } from '../policy'

const SEED = 'seed-idea-1'
const DOM = 'dom-1'

const good = (over: Partial<GoalCandidate> = {}): GoalCandidate => ({
  title: 'Why the DE PPA desk stalls',
  question: 'What is blocking the DE PPA go-live each week?',
  why: 'The accepted idea suggests the blocker is upstream of the desk.',
  seedIds: [SEED],
  successCheck: 'You agree the blocker list is right.',
  dueInDays: 7,
  dominionId: DOM,
  ...over,
})

const ctx = (over: Partial<GoalPolicyContext> = {}): GoalPolicyContext => ({
  validSeedIds: new Set([SEED, 'seed-goal-2']),
  validDominionIds: new Set([DOM]),
  openObjectiveTitles: ['Close Q4 hedging plan'],
  nearestSimilarity: 0.4,
  ...over,
})

describe('checkGoalPolicy', () => {
  it('clears a grounded, novel investigation', () => {
    expect(checkGoalPolicy(good(), ctx())).toEqual({ ok: true })
    expect(checkGoalPolicy(good({ dominionId: null }), ctx())).toEqual({ ok: true })
  })

  it.each([
    ['continuity', { why: 'It protects continuity across sessions.' }],
    ['permissions', { question: 'Which permissions does the desk lack today?' }],
    ['schedule', { title: 'Nightly schedule gaps' }],
    ['budget', { why: 'The budget for the tool is unclear today.' }],
    ['memory', { question: 'What does the memory of last week show?' }],
    ['constitution', { title: 'Constitution coverage review' }],
    ['kairos', { question: 'How could Kairos answer faster each night?' }],
    ['machinery', { why: 'The routines miss the late jobs every night.' }],
  ] as const)('rejects the forbidden topic %s', (topic, over) => {
    expect(checkGoalPolicy(good(over), ctx())).toEqual({ ok: false, reason: 'forbidden_topic', detail: topic })
  })

  it('rejects an action instead of an investigation', () => {
    expect(checkGoalPolicy(good({ title: 'Deploy the new hedge tool' }), ctx())).toMatchObject({ reason: 'not_an_investigation' })
    expect(checkGoalPolicy(good({ question: 'Send the desk the blocker list.' }), ctx())).toMatchObject({ reason: 'not_an_investigation' })
    expect(checkGoalPolicy(good({ question: 'Send the desk the blocker list?' }), ctx())).toMatchObject({ reason: 'not_an_investigation' })
  })

  it.each([2, 15, 0, -1])('rejects dueInDays %i', (dueInDays) => {
    expect(checkGoalPolicy(good({ dueInDays }), ctx())).toMatchObject({ reason: 'due_out_of_range' })
  })

  it('rejects unknown, duplicated or missing seeds and an unknown dominion', () => {
    expect(checkGoalPolicy(good({ seedIds: ['made-up'] }), ctx())).toMatchObject({ reason: 'unknown_seed' })
    expect(checkGoalPolicy(good({ seedIds: [SEED, SEED] }), ctx())).toMatchObject({ reason: 'unknown_seed' })
    expect(checkGoalPolicy(good({ seedIds: [] }), ctx())).toMatchObject({ reason: 'unknown_seed' })
    expect(checkGoalPolicy(good({ dominionId: 'dom-x' }), ctx())).toMatchObject({ reason: 'unknown_dominion' })
  })

  it('rejects over-long and too-short fields', () => {
    expect(checkGoalPolicy(good({ title: 'x'.repeat(121) }), ctx())).toMatchObject({ reason: 'bad_length' })
    expect(checkGoalPolicy(good({ why: 'short' }), ctx())).toMatchObject({ reason: 'bad_length' })
  })

  it('rejects a near-duplicate goal, an open objective restated, and an unmeasured novelty', () => {
    expect(checkGoalPolicy(good(), ctx({ nearestSimilarity: GOAL_NOVELTY_COSINE }))).toMatchObject({ reason: 'duplicate_goal' })
    expect(checkGoalPolicy(good({ title: 'Close Q4 hedging plan' }), ctx())).toMatchObject({ reason: 'duplicates_objective' })
    expect(checkGoalPolicy(good(), ctx({ nearestSimilarity: null }))).toMatchObject({ reason: 'novelty_unchecked' })
  })
})

const FORBIDDEN_WORDS = ['continuity', 'permissions', 'schedule', 'budget', 'memory', 'constitution', 'Kairos', 'routine', 'prompt']
const FIELDS = ['title', 'question', 'why', 'successCheck'] as const

describe('checkGoalPolicy — properties', () => {
  // Fail-closed: whatever else the candidate says, a forbidden word anywhere
  // in its text means no goal.
  test.prop([fc.constantFrom(...FORBIDDEN_WORDS), fc.constantFrom(...FIELDS), fc.boolean()])(
    'never clears a candidate mentioning a forbidden topic',
    (word, field, upper) => {
      const c = good()
      const w = upper ? word.toUpperCase() : word
      const text = field === 'question' ? `What about ${w} here?` : `${c[field].slice(0, 40)} ${w} detail`
      expect(checkGoalPolicy({ ...c, [field]: text }, ctx()).ok).toBe(false)
    },
  )

  test.prop([
    fc.record({
      title: fc.string({ maxLength: 200 }),
      question: fc.string({ maxLength: 400 }),
      why: fc.string({ maxLength: 700 }),
      successCheck: fc.string({ maxLength: 400 }),
      seedIds: fc.array(fc.constantFrom(SEED, 'seed-goal-2', 'other'), { maxLength: 4 }),
      dueInDays: fc.integer({ min: -5, max: 30 }),
      dominionId: fc.option(fc.constantFrom(DOM, 'dom-x'), { nil: null }),
    }),
    fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  ])('never throws, and a cleared candidate satisfies every hard limit', (c, nearest) => {
    const res = checkGoalPolicy(c, ctx({ nearestSimilarity: nearest }))
    if (!res.ok) return
    expect(c.dueInDays).toBeGreaterThanOrEqual(3)
    expect(c.dueInDays).toBeLessThanOrEqual(14)
    expect(c.seedIds.length).toBeGreaterThan(0)
    expect(c.seedIds.every((id) => id === SEED || id === 'seed-goal-2')).toBe(true)
    expect(c.dominionId === null || c.dominionId === DOM).toBe(true)
    expect(c.question.trim().endsWith('?')).toBe(true)
    expect(c.title.trim().length).toBeLessThanOrEqual(120)
    expect(nearest).not.toBeNull()
    expect(nearest as number).toBeLessThan(GOAL_NOVELTY_COSINE)
  })
})
