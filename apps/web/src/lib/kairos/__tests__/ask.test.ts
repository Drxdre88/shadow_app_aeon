import { describe, it, expect } from 'vitest'
import { selectKairosQuestion, type SelectInput } from '../ask-select'
import type { AetherPayload } from '../aether-types'

// ─── fixture helpers ────────────────────────────────────────────────────

const MEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEM_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEM_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const THOUGHT_ID_Q  = '11111111-1111-4111-8111-111111111111'
const THOUGHT_ID_T  = '22222222-2222-4222-8222-222222222222'
const THOUGHT_ID_Q2 = '33333333-3333-4333-8333-333333333333'

const DOM_ID = '99999999-9999-4999-8999-999999999999'

function makePayload(overrides: Partial<AetherPayload> = {}): AetherPayload {
  return {
    generatedAt: '2026-06-12T00:00:00Z',
    coreNarrative: 'A test narrative.',
    thoughts: [],
    tensions: [],
    shifts: [],
    ...overrides,
  }
}

function baseInput(overrides: Partial<SelectInput> = {}): SelectInput {
  return {
    latest: makePayload(),
    priorThoughtSourceIds: [],
    addressedSourceIds: new Set(),
    lastAskedAt: null,
    now: new Date('2026-06-12T10:00:00Z'),
    ...overrides,
  }
}

// ─── selectKairosQuestion ────────────────────────────────────────────────

describe('selectKairosQuestion', () => {
  it('returns null when there are no qualifying thoughts', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Conclusion text',
              insight: 'Some insight.',
              kind: 'conclusion',
              salience: 0.95,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'blue',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).toBeNull()
  })

  it('returns null when all qualifying thoughts are below the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'What should we do next?',
              insight: 'We are at a crossroads.',
              kind: 'question',
              salience: 0.5,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'blue',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).toBeNull()
  })

  it('returns null (silence) when within the cadence window regardless of candidate quality', () => {
    const lastAskedAt = new Date('2026-06-12T04:00:00Z')
    const now = new Date('2026-06-12T10:00:00Z')

    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Is the strategy still valid?',
              insight: 'Worth revisiting.',
              kind: 'question',
              salience: 0.99,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'cyan',
              ageDays: 0,
            },
          ],
        }),
        lastAskedAt,
        now,
      }),
    )
    expect(result).toBeNull()
  })

  it('picks the highest-salience question-kind thought above the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'What is the main bottleneck?',
              insight: 'Performance is degrading.',
              kind: 'question',
              salience: 0.85,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'purple',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_Q2,
              title: 'Should we pivot?',
              insight: 'Direction is unclear.',
              kind: 'question',
              salience: 0.80,
              sourceMemoryIds: [MEM_B],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'purple',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).not.toBeNull()
    expect(result!.sourceThoughtId).toBe(THOUGHT_ID_Q)
    expect(result!.score).toBeCloseTo(0.85)
    expect(result!.question).toContain('?')
  })

  it('persistence boost beats a higher-base one-off candidate when scores are close', () => {
    const priorSourceIds = [[MEM_C, MEM_D]]

    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'One-off high-salience question?',
              insight: 'A fresh insight.',
              kind: 'question',
              salience: 0.85,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'green',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Recurring concern?',
              insight: 'This keeps coming up.',
              kind: 'tension',
              salience: 0.79,
              sourceMemoryIds: [MEM_C, MEM_D],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'green',
              ageDays: 2,
            },
          ],
        }),
        priorThoughtSourceIds: priorSourceIds,
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sourceThoughtId).toBe(THOUGHT_ID_T)
    expect(result!.score).toBeCloseTo(0.79 + 0.15)
  })

  it('drops a candidate whose sourceMemoryIds are all in addressedSourceIds', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Already addressed question?',
              insight: 'We have an answer.',
              kind: 'question',
              salience: 0.95,
              sourceMemoryIds: [MEM_A, MEM_B],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'red',
              ageDays: 0,
            },
          ],
        }),
        addressedSourceIds: new Set([MEM_A, MEM_B]),
      }),
    )
    expect(result).toBeNull()
  })

  it('synthesises a candidate from tensions[] and returns it when above the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Signal A',
              insight: 'First signal.',
              kind: 'conclusion',
              salience: 0.7,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'teal',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Signal B',
              insight: 'Second signal.',
              kind: 'conclusion',
              salience: 0.7,
              sourceMemoryIds: [MEM_B],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
          ],
          tensions: [
            { aId: THOUGHT_ID_Q, bId: THOUGHT_ID_T, note: 'Are these two signals contradicting each other?' },
          ],
        }),
        // a lone tension scores 0.75, below the default 0.78 bar by design;
        // lower the bar here to exercise the synthesis mechanics
        opts: { bar: 0.7 },
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.dominionId).toBeNull()
    expect(result!.sourceThoughtId).toBeNull()
    expect(result!.question).toContain('?')
    expect(result!.sourceMemoryIds).toEqual(expect.arrayContaining([MEM_A, MEM_B]))
    expect(result!.score).toBeCloseTo(0.75)
  })

  it('deduplicates sourceMemoryIds when both tension thoughts share a memory', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Alpha',
              insight: 'Alpha insight.',
              kind: 'conclusion',
              salience: 0.6,
              sourceMemoryIds: [MEM_A, MEM_B],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Beta',
              insight: 'Beta insight.',
              kind: 'conclusion',
              salience: 0.6,
              sourceMemoryIds: [MEM_B, MEM_C],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
          ],
          tensions: [{ aId: THOUGHT_ID_Q, bId: THOUGHT_ID_T, note: 'Alpha and Beta diverge' }],
        }),
        opts: { bar: 0.7 },
      }),
    )

    expect(result).not.toBeNull()
    const ids = result!.sourceMemoryIds
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
    expect(unique.has(MEM_B)).toBe(true)
  })
})
