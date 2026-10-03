import { describe, expect, it } from 'vitest'
import { buildWeeklyReviewPrompt, groundWeeklyReview, parseWeeklyReviewText, weeklyReviewSchema } from '@/lib/kairos/weekly-review/prompt'
import { renderWeeklyReviewMarkdown, renderWeeklyReviewMessage } from '@/lib/kairos/weekly-review/render'
import type { WeeklyReviewInputs } from '@/lib/kairos/weekly-review/inputs'
import { buildReviewPredictionContext } from '../prompt-block'
import { NOW, prediction, state } from './fixtures'

// The weekly review stays lenient about predictions: a bad prediction (or a
// bad list) is dropped, never the review.

const base = { summary: 'A steady week with one stalled objective.', wins: [], drift: [], actions: [] }
const good = { claim: 'The inbox fix reaches every beta user by Friday', probability: 0.7, dueDate: '2026-10-10', topic: 'delivery' }

describe('weekly review predictions (lenient parse)', () => {
  it('a null, string or object predictions field never costs the review', () => {
    for (const predictions of [null, 'soon', { claim: 'x' }, 42]) {
      const parsed = weeklyReviewSchema.parse({ ...base, predictions })
      expect(parsed.summary).toBe(base.summary)
      expect(parsed.predictions).toBeUndefined()
    }
  })

  it('drops malformed items, keeps good ones, caps the list at 6', () => {
    const parsed = weeklyReviewSchema.parse({
      ...base,
      predictions: [good, { claim: null }, { probability: 0.7 }, 'R1', { ...good, basisIds: 'nope' }, ...Array(10).fill(good)],
    })
    expect(parsed.predictions).toHaveLength(6)
    expect(parsed.predictions?.[0]).toEqual(good)
  })

  it('full text parse survives a broken prediction and grounding carries the rest', () => {
    const text = '```json\n' + JSON.stringify({ ...base, predictions: [{ claim: 5 }, { ...good, probability: '0.8' }] }) + '\n```'
    const review = parseWeeklyReviewText(text, [], [])
    expect(review.summary).toBe(base.summary)
    expect(review.predictions).toEqual([{ ...good, probability: '0.8' }])
    expect(groundWeeklyReview({ ...base }, [], []).predictions).toEqual([])
  })
})

describe('weekly review prompt + render', () => {
  const inputs: WeeklyReviewInputs = {
    window: { isoWeek: '2026-W40', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') },
    dominions: [], boardPages: [], objectives: [], beliefChanges: [], memoryOps: null, mindCompare: null,
    asks: [], asksAnswered: 0, health: [], errors: [],
  }

  it('asks for predictions only when given a context, with the track record and open list', () => {
    expect(buildWeeklyReviewPrompt(inputs)).not.toContain('PREDICTIONS')
    const ctx = buildReviewPredictionContext(state([prediction(3)]), NOW)
    const prompt = buildWeeklyReviewPrompt(inputs, undefined, undefined, ctx)
    expect(prompt).toContain('TRACK RECORD')
    expect(prompt).toContain('PREDICTIONS — you may add up to 3')
    expect(prompt).toContain('between 2026-10-02 and 2026-10-29')
    expect(prompt).toContain('- R3 (80%) due 2026-10-05:')
  })

  it('renders the code-built track-record line only when present', () => {
    const review = groundWeeklyReview({ ...base }, [], [])
    const line = 'Track record (90 days): 4 of 5 predictions right (80%) · Brier 0.16 · over-confidence +0 pts'
    expect(renderWeeklyReviewMarkdown(review, '2026-W40')).not.toContain('Track record')
    expect(renderWeeklyReviewMarkdown(review, '2026-W40', line).endsWith(line)).toBe(true)
    expect(renderWeeklyReviewMessage(review, 0)).toBe(base.summary)
    expect(renderWeeklyReviewMessage(review, 2, line)).toBe(`${base.summary}\n\nI've put 2 proposed actions for this week in your inbox.\n\n${line}`)
  })
})
