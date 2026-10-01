import { describe, expect, it } from 'vitest'
import { buildWeeklyReviewPrompt, groundWeeklyReview, type WeeklyReviewOutput } from '../prompt'
import type { WeeklyReviewInputs } from '../inputs'

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

describe('ideas, lessons and belief diff in the prompt', () => {
  const base: WeeklyReviewInputs = {
    window: { isoWeek: '2026-W40', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') },
    dominions: [], boardPages: [], objectives: [], beliefChanges: [], memoryOps: null, mindCompare: null,
    asks: [], asksAnswered: 0, health: [], errors: [],
  }

  it('renders survivors with outcomes, the diversity alarm, lessons and the grouped belief diff', () => {
    const prompt = buildWeeklyReviewPrompt({
      ...base,
      ideas: {
        survivors: [{ id: FED, title: 'Batch digests', claim: 'One digest a week', direction: 'ops', survivedBecause: 'won 3/3', elo: 1061.4, tournamentDate: '2026-09-30', outcome: 'dismissed' }],
        diversity: { survivors: 4, meanDistance: 0.12, alarm: true },
      },
      ideaLessons: { days: 30, accepted: [], dismissed: [{ id: OTHER, title: 'T', direction: 'd', claim: 'c' }], acceptedCount: 0, dismissedCount: 1 },
      beliefDiff: {
        total: 3, truncated: false, counts: { replaced: 1, flagged: 2 },
        changes: [{ memoryId: FED, kind: 'replaced', domain: 'health', mind: 'aligned', claim: 'Sleep first', reason: 'new evidence; replaces x', at: '' }],
      },
    })
    expect(prompt).toContain(`- [${FED}] dismissed · ops · Batch digests: One digest a week (2026-09-30, elo 1061; survived because won 3/3)`)
    expect(prompt).toContain('ALARM: ideas are getting samey')
    expect(prompt).toContain('accepted 0, dismissed 1')
    expect(prompt).toContain(`- [${OTHER}] dismissed`)
    expect(prompt).toContain('- 3 changes: replaced 1, flagged 2 (showing the 1 most significant)')
    expect(prompt).toContain('[domain: health]')
    expect(prompt).toContain(`[${FED}] replaced an older belief (aligned mind): Sleep first — new evidence; replaces x`)
  })

  it('says so when there are no ideas or belief changes', () => {
    const prompt = buildWeeklyReviewPrompt(base)
    expect(prompt).toContain('(no surviving ideas this week)')
    expect(prompt).toContain('(no idea outcomes yet)')
    expect(prompt).toContain('(no belief changes)')
  })

  it('keeps at most one idea-quality action', () => {
    const r = groundWeeklyReview({
      ...out([FED]),
      actions: [
        { title: 'More ops ideas', why: 'accepted', evidenceIds: [FED], ideaQuality: true },
        { title: 'Fewer health ideas', why: 'dismissed', evidenceIds: [OTHER], ideaQuality: true },
        { title: 'Re-plan P2', why: 'stalled', evidenceIds: [FED], ideaQuality: false },
      ],
    }, [FED, OTHER], DOMS)
    expect(r.actions.map((a) => [a.title, a.ideaQuality ?? false])).toEqual([['More ops ideas', true], ['Re-plan P2', false]])
    expect(r.droppedActions).toBe(1)
  })
})