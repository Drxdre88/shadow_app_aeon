import { describe, expect, it } from 'vitest'
import { groundWeeklyReview, type WeeklyReviewOutput } from '../prompt'

const FED = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'
const DOMS = [{ id: 'dom-1', name: 'Swarm' }]

function out(evidenceIds: string[]): WeeklyReviewOutput {
  return {
    summary: 'A steady week with one stalled objective.',
    wins: [],
    drift: [],
    actions: [{ title: 'Re-plan P2', why: 'It stalled', evidenceIds, dominion: 'swarm' }],
  }
}

describe('groundWeeklyReview (shared fed-id resolver)', () => {
  it('resolves decorated or shortened citations to the canonical fed id', () => {
    const r = groundWeeklyReview(out([`[${FED.toUpperCase()}]`, 'mem:aaaaaaaa', FED]), [FED, OTHER], DOMS)
    expect(r.actions).toEqual([expect.objectContaining({ evidenceIds: [FED], dominionId: 'dom-1', dominionName: 'Swarm' })])
    expect(r.droppedActions).toBe(0)
  })

  it('drops an action whose only evidence was never fed', () => {
    const r = groundWeeklyReview(out(['cccccccc-0000-4000-8000-000000000003']), [FED, OTHER], DOMS)
    expect(r.actions).toEqual([])
    expect(r.droppedActions).toBe(1)
  })
})
