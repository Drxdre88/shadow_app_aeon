import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWeeklyReviewPrompt, groundWeeklyReview, weeklyReviewSchema, type WeeklyReviewOutput } from '../prompt'
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

describe('weeklyReviewSchema promises (lenient)', () => {
  const base = { summary: 'A steady week with one stalled objective.', wins: [], drift: [], actions: [] }
  const good = { outcome: 'Ship the inbox fix to beta', dueDate: '2026-10-10' }

  it('a null or non-array promises field never costs the review', () => {
    expect(weeklyReviewSchema.parse({ ...base, promises: null }).promises).toBeUndefined()
    expect(weeklyReviewSchema.parse({ ...base, promises: 'soon' }).promises).toBeUndefined()
  })

  it('drops malformed items, keeps good ones, caps the list', () => {
    const parsed = weeklyReviewSchema.parse({ ...base, promises: [good, { outcome: null }, { dueDate: '2026-10-10' }, ...Array(10).fill(good)] })
    expect(parsed.promises?.length).toBe(6)
    expect(parsed.promises?.[0]).toEqual(good)
  })
})

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

describe('initiative metrics in the prompt', () => {
  afterEach(() => vi.unstubAllEnvs())

  const base: WeeklyReviewInputs = {
    window: { isoWeek: '2026-W40', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') },
    dominions: [], boardPages: [], objectives: [], beliefChanges: [], memoryOps: null, mindCompare: null,
    asks: [], asksAnswered: 0, health: [], errors: [],
    initiative: {
      goalDays: 7,
      goals: {
        proposed: 4, pending: 1, approved: 2, vetoed: 1, expired: 0, active: 1, done: 1, failed: 1, abandoned: 0,
        acceptanceRate: 2 / 3, doneCheckedRate: 0.5, medianDecisionMinutes: 95,
      },
      promises: { kept: 3, lapsed: 1, dropped: 0, keptRate: 0.75 },
    },
  }

  it('renders acceptance, done-and-checked, median decision time and promise kept-rate when the initiative is on', () => {
    vi.stubEnv('KAIROS_INITIATIVE', '1')
    const prompt = buildWeeklyReviewPrompt(base)
    expect(prompt).toContain('INITIATIVE — your own goals (proposed in the last 7 days)')
    expect(prompt).toContain('- Goals: 4 proposed · approved 2, vetoed 1, expired 0, still pending 1')
    expect(prompt).toContain('Acceptance rate: 67% · done-and-checked rate: 50% (done 1, failed 1, abandoned 0) · median decision time: 95 min')
    expect(prompt).toContain('- Promises kept: 75% (kept 3, lapsed 1, dropped 0)')
  })

  it('says n/a before any decision and handles a missing half', () => {
    vi.stubEnv('KAIROS_INITIATIVE', '1')
    const prompt = buildWeeklyReviewPrompt({
      ...base,
      initiative: {
        goalDays: 7,
        goals: { ...base.initiative!.goals!, acceptanceRate: null, doneCheckedRate: null, medianDecisionMinutes: null },
        promises: null,
      },
    })
    expect(prompt).toContain('Acceptance rate: n/a · done-and-checked rate: n/a')
    expect(prompt).toContain('median decision time: n/a')
    expect(prompt).toContain('- Promises: (none closed this week)')
  })

  it('is silent while the initiative is off, even if the input is present', () => {
    vi.stubEnv('KAIROS_INITIATIVE', '0')
    expect(buildWeeklyReviewPrompt(base)).not.toContain('INITIATIVE')
  })
})