import { describe, expect, it } from 'vitest'
import { captureMemorySchema, createMemorySchema, GOAL_METADATA_REFUSAL } from '@/lib/data/validators/memory'
import { goalPatchRefusal, isGoalRow, OPERATOR_ONLY_GOAL_ERROR } from '../guards'
import { appendGoalHistory, GOAL_HISTORY_CAP, parseGoalProposeText, readGoalMeta, type GoalHistoryEntry } from '../parse'

const candidate = {
  title: 'Why the desk stalls',
  question: 'What blocks go-live?',
  why: 'Seeded by an accepted idea.',
  seedIds: ['s1'],
  successCheck: 'You agree.',
  dueInDays: 7,
  dominionId: null,
}

describe('parseGoalProposeText', () => {
  it('reads {"goal": null} as no goal', () => {
    expect(parseGoalProposeText('{"goal": null}')).toBeNull()
  })

  it('reads a fenced candidate', () => {
    expect(parseGoalProposeText('```json\n' + JSON.stringify({ goal: candidate }) + '\n```')).toEqual(candidate)
  })

  it.each([
    ['an extra top-level key', { goal: null, note: 'x' }],
    ['an extra goal key', { goal: { ...candidate, action: 'deploy' } }],
    ['no seeds', { goal: { ...candidate, seedIds: [] } }],
    ['a fractional due', { goal: { ...candidate, dueInDays: 2.5 } }],
    ['a missing field', { goal: { ...candidate, why: undefined } }],
  ])('rejects %s (strict)', (_label, body) => {
    expect(() => parseGoalProposeText(JSON.stringify(body))).toThrow(/goal-propose/)
  })

  it('rejects text with no JSON', () => {
    expect(() => parseGoalProposeText('I would rather not.')).toThrow()
  })
})

describe('readGoalMeta / appendGoalHistory', () => {
  it('returns null for rows without valid goal meta', () => {
    expect(readGoalMeta(null)).toBeNull()
    expect(readGoalMeta({ goal: { state: 'proposed' } })).toBeNull()
  })

  it('keeps only the newest history entries', () => {
    const entry = (i: number): GoalHistoryEntry => ({ at: `t${i}`, event: 'expire', from: 'proposed', to: 'expired', actor: 'system' })
    const full = Array.from({ length: GOAL_HISTORY_CAP }, (_, i) => entry(i))
    const next = appendGoalHistory(full, entry(99))
    expect(next).toHaveLength(GOAL_HISTORY_CAP)
    expect(next.at(-1)?.at).toBe('t99')
    expect(next[0].at).toBe('t1')
  })
})

describe('goal guards', () => {
  const proposal = { type: 'inbound', sourceMetadata: { kind: 'goal', status: 'pending' }, title: 'T', bodyMd: 'B', summary: 'S' }
  const approved = { type: 'kairos_goal', sourceMetadata: { status: 'accepted' }, title: 'T', bodyMd: 'B', summary: 'S' }

  it('recognises proposals and approved goals', () => {
    expect(isGoalRow(proposal)).toBe(true)
    expect(isGoalRow(approved)).toBe(true)
    expect(isGoalRow({ type: 'inbound', sourceMetadata: { kind: 'idea' } })).toBe(false)
    expect(isGoalRow(null)).toBe(false)
  })

  it('refuses archive / unarchive, retype and rewrites; allows summary backfill, tags and pinned', () => {
    for (const row of [proposal, approved]) {
      expect(goalPatchRefusal(row, { archivedAt: '2026-10-02T00:00:00.000Z' })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { archivedAt: null })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { type: 'note' })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { title: 'New' })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { bodyMd: 'New' })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { summary: null })).toBe(OPERATOR_ONLY_GOAL_ERROR)
      expect(goalPatchRefusal(row, { title: 'T', bodyMd: 'B' })).toBeNull()
      expect(goalPatchRefusal(row, {})).toBeNull()
    }
    expect(goalPatchRefusal({ type: 'note', sourceMetadata: {} }, { archivedAt: '2026-10-02T00:00:00.000Z' })).toBeNull()
  })
})

describe('create / capture validators refuse goal metadata', () => {
  const base = { title: 't', bodyMd: 'b' }
  it.each([
    ['kind goal', { kind: 'goal' }],
    ['a goal key', { goal: { state: 'active' } }],
    ['a null goal key', { goal: null }],
  ])('rejects %s', (_label, sourceMetadata) => {
    for (const schema of [createMemorySchema, captureMemorySchema]) {
      const res = schema.safeParse({ ...base, sourceMetadata })
      expect(res.success).toBe(false)
      expect(res.error?.issues[0].message).toBe(GOAL_METADATA_REFUSAL)
    }
  })

  it('still accepts ordinary metadata and none', () => {
    for (const schema of [createMemorySchema, captureMemorySchema]) {
      expect(schema.safeParse({ ...base, sourceMetadata: { repo: 'aeon', kind: 'idea' } }).success).toBe(true)
      expect(schema.safeParse(base).success).toBe(true)
    }
  })
})
