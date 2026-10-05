import { afterEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { emptyIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { pickAtlasTargets } from '@/lib/kairos/ideas/atlas/targets'
import { buildWeeklyReviewPrompt } from '@/lib/kairos/weekly-review/prompt'
import type { WeeklyReviewInputs } from '@/lib/kairos/weekly-review/inputs'
import { askFocusRoster } from '../plan-ask'
import { focusObjectiveFilter } from '../plan-focus'
import { listIdeaFocusDominions } from '../plan-ideas'

// Living Dominions lane C: weekly review, question of the day, ideas and
// readiness change only when KAIROS_LIVING_DOMINIONS is 'on'.

const h = vi.hoisted(() => ({ listActiveDominions: vi.fn(), listFocusDominions: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/idea-inputs', () => ({ listActiveDominions: h.listActiveDominions }))
vi.mock('@/lib/data/dominion-focus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/dominion-focus')>()),
  listFocusDominions: h.listFocusDominions,
}))

const prior = process.env.KAIROS_LIVING_DOMINIONS
const setMode = (mode: string | undefined) => {
  if (mode === undefined) delete process.env.KAIROS_LIVING_DOMINIONS
  else process.env.KAIROS_LIVING_DOMINIONS = mode
}
afterEach(() => {
  setMode(prior)
  vi.clearAllMocks()
})

const dom = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), archivedAt: null as Date | null, focusState: 'active', pinned: false, ...over,
})
const ROSTER = [
  dom('hq', { focusState: 'dormant' }),
  dom('strat', { focusState: 'dormant', pinned: true }),
  dom('swarm'),
  dom('gone', { archivedAt: new Date('2026-09-01') }),
]
const REFLECTIONS = ['hq', 'strat', 'swarm'].map((dominionId) => ({ dominionId, dominionName: dominionId, lastReflectedAt: null }))

describe('askFocusRoster (question of the day)', () => {
  it.each([undefined, 'observe'])('mode %s: every live Dominion, staleness untouched', async (mode) => {
    setMode(mode)
    const r = await askFocusRoster(ROSTER, REFLECTIONS)
    expect([...r.validDominionIds]).toEqual(['hq', 'strat', 'swarm'])
    expect(r.reflectionRows).toBe(REFLECTIONS)
  })

  it("'on': dormant Dominions are neither targets nor 'not reflected on' signals; pinned stay", async () => {
    setMode('1')
    const r = await askFocusRoster(ROSTER, REFLECTIONS)
    expect([...r.validDominionIds]).toEqual(['strat', 'swarm'])
    expect(r.reflectionRows.map((x) => x.dominionId)).toEqual(['strat', 'swarm'])
  })
})

describe('listIdeaFocusDominions (idea generation roster)', () => {
  const live = (id: string, dormant: boolean) => ({ id, name: id, dormant })

  it.each([undefined, 'observe'])('mode %s: the old live roster', async (mode) => {
    setMode(mode)
    h.listActiveDominions.mockResolvedValue([{ id: 'a', name: 'A' }])
    expect(await listIdeaFocusDominions('u1')).toEqual([{ id: 'a', name: 'A' }])
    expect(h.listFocusDominions).not.toHaveBeenCalled()
  })

  it("'on': the ranked awake roster from the seam", async () => {
    setMode('on')
    h.listFocusDominions.mockResolvedValue([live('stp', false), live('swarm', false)])
    expect(await listIdeaFocusDominions('u1')).toEqual([{ id: 'stp', name: 'stp' }, { id: 'swarm', name: 'swarm' }])
    expect(h.listActiveDominions).not.toHaveBeenCalled()
  })

  it("'on' with every Dominion dormant: ideas still run on all of them, flagged dormant", async () => {
    setMode('on')
    h.listFocusDominions.mockImplementation(async (_u: string, opts?: { includeDormant?: boolean }) =>
      (opts?.includeDormant ? [live('hq', true), live('spec', true)] : []))
    expect(await listIdeaFocusDominions('u1')).toEqual([
      { id: 'hq', name: 'hq', dormant: true },
      { id: 'spec', name: 'spec', dormant: true },
    ])
  })
})

describe('pickAtlasTargets', () => {
  it('never targets a dormant Dominion cell, keeps cross', () => {
    const state = emptyIdeaAtlasState()
    const targets = pickAtlasTargets(state, [{ id: 'live' }, { id: 'quiet', dormant: true }], '2026-10-05', 100)
    expect(targets.some((k) => k.startsWith('quiet|'))).toBe(false)
    expect(targets.some((k) => k.startsWith('live|'))).toBe(true)
    expect(targets.some((k) => k.startsWith('cross|'))).toBe(true)
  })

  it('rosters without the flag pick exactly as before', () => {
    const state = emptyIdeaAtlasState()
    expect(pickAtlasTargets(state, [{ id: 'a' }, { id: 'b', dormant: false }], '2026-10-05'))
      .toEqual(pickAtlasTargets(state, [{ id: 'a' }, { id: 'b' }], '2026-10-05'))
  })
})

describe('focusObjectiveFilter (readiness goals)', () => {
  it.each([undefined, 'observe', '0'])('mode %s: no extra condition', (mode) => {
    setMode(mode)
    expect(focusObjectiveFilter()).toBeUndefined()
  })

  it("'on': only goals of live, awake (or pinned) Dominions", () => {
    setMode('1')
    const { sql: text } = new PgDialect().sqlToQuery(focusObjectiveFilter() as SQL)
    expect(text).toContain('exists (select 1 from "dominions"')
    expect(text).toContain('"dominions"."id" = "dominion_objectives"."dominion_id"')
    expect(text).toContain('"dominions"."archived_at" is null')
    expect(text).toContain(`("dominions"."pinned" or "dominions"."focus_state" <> 'dormant')`)
  })
})

describe('weekly review prompt quiet line', () => {
  const base: WeeklyReviewInputs = {
    window: { isoWeek: '2026-W40', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') },
    dominions: [{ id: 'd1', name: 'Swarm' }, { id: 'd2', name: 'STP HQ' }],
    boardPages: [], objectives: [], beliefChanges: [], memoryOps: null, mindCompare: null,
    asks: [], asksAnswered: 0, health: [], errors: [],
  }

  it('names dormant Dominions once, as quiet by choice', () => {
    const prompt = buildWeeklyReviewPrompt({ ...base, quietDominions: ['STP HQ'] })
    expect(prompt.match(/Quiet by choice/g)).toHaveLength(1)
    expect(prompt).toContain("Quiet by choice (dormant): STP HQ — don't judge them as stalled.")
  })

  it('no quiet Dominions: the prompt is unchanged', () => {
    expect(buildWeeklyReviewPrompt({ ...base, quietDominions: [] })).toBe(buildWeeklyReviewPrompt(base))
    expect(buildWeeklyReviewPrompt(base)).not.toContain('Quiet by choice')
  })
})
