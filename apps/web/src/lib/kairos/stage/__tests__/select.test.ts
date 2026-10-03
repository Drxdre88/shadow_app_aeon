import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { kairosStageStateSchema, STAGE_MAX_BYTES } from '@/lib/data/validators/kairos-stage'
import {
  activeFocus,
  applyStagePost,
  decayedMass,
  effectiveStrength,
  emptyStageState,
  londonCycleKey,
  rankCoalitions,
  salience,
  stageNeedsRollover,
  stageTierForKind,
  surpriseSince,
} from '../select'
import type { AmbientCandidate, KairosStageState, StageCandidateInput, StageCoalition, StagePost } from '../types'

// 2026-10-03 is BST: London = UTC+1.
const at = (h: number, m = 0, day = 3) => new Date(Date.UTC(2026, 9, day, h, m))

const item = (text: string, over: Partial<StageCandidateInput> = {}): StageCandidateInput => ({
  text, importance: 0.8, surprise: 0.6, goalRelevance: 0.5, need: 0.4, ...over,
})

function post(state: KairosStageState, p: Partial<StagePost> & { items: StageCandidateInput[] }, now: Date) {
  const full: StagePost = { kind: 'reflect', source: 'job', tier: 'deep', jobId: `job-${now.toISOString()}-${Math.random()}`, ...p }
  return applyStagePost(state, { post: full }, now)
}

function must(r: { state: KairosStageState | null }): KairosStageState {
  expect(r.state).not.toBeNull()
  return r.state!
}

function coalition(over: Partial<StageCoalition>): StageCoalition {
  return {
    id: 'c_aaaaaaaa', text: 'placeholder thought', cites: [],
    components: { importance: 0.5, surprise: 0.5, goalRelevance: 0.5, need: 0.5 },
    mass: 0.5, massAt: at(9).toISOString(), firstAt: at(9).toISOString(), wins: 0, deepBacked: true,
    members: [], ...over,
  }
}

describe('salience and decay', () => {
  it('weights 0.35/0.25/0.25/0.15, clamps, and scales the light tier by 0.6', () => {
    const c = { importance: 1, surprise: 0.4, goalRelevance: 0.2, need: 0 }
    expect(salience(c, 'deep')).toBeCloseTo(0.35 + 0.1 + 0.05, 10)
    expect(salience(c, 'light')).toBeCloseTo(0.5 * 0.6, 10)
    expect(salience({ importance: 1, surprise: 1, goalRelevance: 1, need: 1 }, 'owner')).toBe(1)
  })

  it('halves mass every 6 hours and applies ×0.85 inhibition per consecutive win', () => {
    const c = coalition({ mass: 1, massAt: at(0).toISOString(), wins: 2 })
    expect(decayedMass(c, at(6))).toBeCloseTo(0.5, 10)
    expect(effectiveStrength(c, at(6))).toBeCloseTo(0.5 * 0.85 * 0.85, 10)
  })

  it('maps kinds to tiers from the brain catalog (pulse is light)', () => {
    expect(stageTierForKind('pulse')).toBe('light')
    expect(stageTierForKind('reflect')).toBe('deep')
    expect(stageTierForKind('unknown_kind')).toBe('deep')
  })

  it('keys cycles by the London hour', () => {
    expect(londonCycleKey(at(9, 10))).toBe('2026-10-03T10')
    expect(londonCycleKey(at(23, 30))).toBe('2026-10-04T00')
  })
})

describe('coalitions', () => {
  it('a new thought opens a coalition; a similar one merges into it with decayed mass', () => {
    let s = must(post(emptyStageState(), { items: [item('Billing migration is slipping behind schedule')] }, at(9)))
    expect(s.coalitions).toHaveLength(1)
    expect(s.coalitions[0].id).toMatch(/^c_[0-9a-f]{8}$/)
    const first = s.coalitions[0].mass
    const r = post(s, { items: [item('The billing migration keeps slipping behind schedule')] }, at(9, 30))
    s = must(r)
    expect(r.result).toMatchObject({ posted: 1, merged: 1 })
    expect(s.coalitions).toHaveLength(1)
    expect(s.coalitions[0].mass).toBeCloseTo(decayedMass({ mass: first, massAt: at(9).toISOString() }, at(9, 30)) + first, 10)
    expect(s.coalitions[0].members).toHaveLength(2)
  })

  it('weak overlap (≥0.3) merges only when the two share a cite', () => {
    const base = must(post(emptyStageState(), { items: [item('billing migration slipping owner worried deadline', { cites: ['mem-1'] })] }, at(9)))
    const other = 'billing migration slipping vendor contract renewal pending'
    expect(must(post(base, { items: [item(other)] }, at(9, 5))).coalitions).toHaveLength(2)
    expect(must(post(base, { items: [item(other, { cites: ['mem-1'] })] }, at(9, 5))).coalitions).toHaveLength(1)
  })

  it('re-posting the same job is a no-op', () => {
    const s = must(post(emptyStageState(), { jobId: 'job-1', items: [item('A thought worth holding')] }, at(9)))
    const again = post(s, { jobId: 'job-1', items: [item('Another thought entirely here')] }, at(9, 10))
    expect(again.state).toBeNull()
    expect(again.result.skipped).toBe('duplicate_job')
  })

  it('echo rule: handing a given coalition back with no new cites adds nothing', () => {
    const s = must(post(emptyStageState(), { items: [item('Billing migration is slipping behind schedule', { cites: ['m1'] })] }, at(9)))
    const c = s.coalitions[0]
    const echoed = post(s, { given: [c.id], items: [item('Billing migration slipping behind schedule again', { cites: ['m1'] })] }, at(9, 20))
    const e = must(echoed)
    expect(echoed.result).toMatchObject({ echoed: 1, posted: 0 })
    expect(e.coalitions[0].mass).toBe(c.mass)
    expect(e.coalitions[0].members.at(-1)).toMatchObject({ echo: true, base: 0 })
    expect(e.surprise).toHaveLength(1)
    const fresh = post(s, { given: [c.id], items: [item('Billing migration slipping behind schedule again', { cites: ['m2'] })] }, at(9, 20))
    expect(fresh.result).toMatchObject({ merged: 1 })
    expect(must(fresh).coalitions[0].cites).toEqual(['m1', 'm2'])
  })

  it('keeps at most 16 coalitions (the strongest) and 6 newest members each', () => {
    let s = emptyStageState()
    for (let i = 0; i < 20; i++) {
      s = must(post(s, { items: [item(`distinct topic number${i} alpha${i} beta${i}`, { importance: i / 20 })] }, at(9, i)))
    }
    expect(s.coalitions).toHaveLength(16)
    expect(s.coalitions.some((c) => c.text.includes('number0 '))).toBe(false)
    for (let i = 0; i < 8; i++) s = must(post(s, { items: [item('distinct topic number19 alpha19 beta19')] }, at(9, 30 + i)))
    expect(s.coalitions.find((c) => c.text.includes('number19'))!.members).toHaveLength(6)
  })

  it('records ambient facts once per key', () => {
    const amb: AmbientCandidate = { key: 'promise:p1:2026-10-03', kind: 'promise', source: 'promise', tier: 'deep', ...item('A promise is overdue: ship the report') }
    const s = must(applyStagePost(emptyStageState(), { ambient: [amb] }, at(9)))
    expect(s.ambientSeen).toEqual([amb.key])
    expect(s.coalitions[0].members[0]).toMatchObject({ source: 'promise', kind: 'promise' })
    const again = applyStagePost(s, { ambient: [amb] }, at(9, 5))
    expect(again.result.skipped).toBe('empty')
  })

  it('sums posted surprise since a moment (light tier scaled)', () => {
    let s = must(post(emptyStageState(), { items: [item('first surprising thing happened', { surprise: 1 })] }, at(9)))
    s = must(post(s, { kind: 'pulse', tier: 'light', items: [item('pulse noticed something else odd', { surprise: 1 })] }, at(10)))
    expect(surpriseSince(s, at(8), at(11))).toBeCloseTo(1.6, 10)
    expect(surpriseSince(s, at(9, 30), at(11))).toBeCloseTo(0.6, 10)
  })
})

describe('cycles, ignition and focus', () => {
  const topic = 'Ship the billing migration before the audit'

  function hourly(tier: 'deep' | 'light', hours: number[]): KairosStageState {
    let s = emptyStageState()
    for (const h of hours) s = must(post(s, { tier, kind: tier === 'light' ? 'pulse' : 'reflect', items: [item(topic, { importance: 1 })] }, at(h, 5)))
    return s
  }

  it('the first post in a new London hour closes the previous cycle with its winner', () => {
    const s = hourly('deep', [9, 10])
    expect(s.cycles).toHaveLength(1)
    expect(s.cycles[0]).toMatchObject({ cycle: '2026-10-03T10', winnerId: s.coalitions[0].id, top: [s.coalitions[0].id] })
    expect(s.coalitions[0].wins).toBe(1)
    expect(stageNeedsRollover(s, at(10, 30))).toBe(false)
    expect(stageNeedsRollover(s, at(11, 1))).toBe(true)
  })

  it('a winner below 0.15 effective strength leaves the cycle without a winner', () => {
    let s = must(post(emptyStageState(), { items: [item('barely there thought text', { importance: 0.1, surprise: 0, goalRelevance: 0, need: 0 })] }, at(9)))
    s = must(post(s, { items: [item('another unrelated thought text')] }, at(10, 5)))
    expect(s.cycles[0].winnerId).toBeNull()
    expect(s.coalitions.every((c) => c.wins === 0)).toBe(true)
  })

  it('three consecutive wins by a deep-backed coalition ignite the day\'s focus', () => {
    const s = hourly('deep', [9, 10, 11, 12])
    expect(s.coalitions[0].wins).toBe(3)
    expect(s.focus).toMatchObject({ coalitionId: s.coalitions[0].id, text: topic, londonDate: '2026-10-03' })
  })

  it('a light-only coalition never ignites, however often it wins', () => {
    const s = hourly('light', [9, 10, 11, 12, 13])
    expect(s.coalitions[0].wins).toBe(4)
    expect(s.coalitions[0].deepBacked).toBe(false)
    expect(s.focus).toBeNull()
  })

  it('focus resets at London midnight', () => {
    const s = hourly('deep', [9, 10, 11, 12])
    expect(activeFocus(s, at(22, 59))).not.toBeNull()
    expect(activeFocus(s, at(23, 1))).toBeNull()
  })

  function contested(focusMass: number): KairosStageState {
    const a = coalition({ id: 'c_aaaaaaaa', text: 'held focus topic', mass: focusMass, massAt: at(10, 50).toISOString() })
    const b = coalition({ id: 'c_bbbbbbbb', text: 'rising other topic', mass: 2, massAt: at(10, 50).toISOString(), wins: 2 })
    return {
      ...emptyStageState(),
      updatedAt: at(10, 50).toISOString(),
      coalitions: [a, b],
      cycles: [{ cycle: '2026-10-03T10', winnerId: 'c_bbbbbbbb', top: ['c_bbbbbbbb', 'c_aaaaaaaa'], at: at(10, 5).toISOString() }],
      focus: { coalitionId: 'c_aaaaaaaa', text: 'held focus topic', since: at(8).toISOString(), londonDate: '2026-10-03' },
    }
  }

  it('a new ignition replaces the focus only when ≥1.5× stronger', () => {
    // B wins its third cycle at 2·0.85² ≈ 1.445.
    const replaced = must(post(contested(0.5), { items: [item('unrelated fresh note words')] }, at(11, 5)))
    expect(replaced.focus?.coalitionId).toBe('c_bbbbbbbb')
    const kept = must(post(contested(1.0), { items: [item('unrelated fresh note words')] }, at(11, 5)))
    expect(kept.focus?.coalitionId).toBe('c_aaaaaaaa')
  })

  it('ranks by effective strength, deepOnly hides light-only coalitions', () => {
    const s: KairosStageState = {
      ...emptyStageState(),
      coalitions: [coalition({ id: 'c_11111111', mass: 0.9, deepBacked: false }), coalition({ id: 'c_22222222', mass: 0.5 })],
    }
    expect(rankCoalitions(s, at(9)).map((r) => r.coalition.id)).toEqual(['c_11111111', 'c_22222222'])
    expect(rankCoalitions(s, at(9), { deepOnly: true }).map((r) => r.coalition.id)).toEqual(['c_22222222'])
  })
})

describe('selector invariants (property)', () => {
  const words = ['billing', 'audit', 'migration', 'hiring', 'roadmap', 'launch', 'pricing', 'design', 'invoice', 'vendor', 'research', 'health']
  const itemArb = fc.record({
    text: fc.array(fc.constantFrom(...words), { minLength: 2, maxLength: 6 }).map((w) => w.join(' ')),
    importance: fc.double({ min: 0, max: 1, noNaN: true }),
    surprise: fc.double({ min: 0, max: 1, noNaN: true }),
    goalRelevance: fc.double({ min: 0, max: 1, noNaN: true }),
    need: fc.double({ min: 0, max: 1, noNaN: true }),
    cites: fc.array(fc.constantFrom('m1', 'm2', 'm3', 'm4'), { maxLength: 3 }),
  })
  const stepArb = fc.record({
    minutes: fc.integer({ min: 1, max: 180 }),
    light: fc.boolean(),
    job: fc.integer({ min: 0, max: 40 }),
    items: fc.array(itemArb, { minLength: 0, maxLength: 3 }),
  })

  test.prop([fc.array(stepArb, { minLength: 1, maxLength: 60 })], { numRuns: 60 })(
    'stays schema-valid and within caps; light-only never holds focus; job re-posts are no-ops',
    (steps) => {
      let s = emptyStageState()
      let t = at(6).getTime()
      for (const step of steps) {
        t += step.minutes * 60_000
        const now = new Date(t)
        const jobId = `job-${step.job}`
        const r = post(s, { jobId, tier: step.light ? 'light' : 'deep', kind: step.light ? 'pulse' : 'reflect', items: step.items }, now)
        if (s.postedJobs.includes(jobId)) {
          expect(r.state).toBeNull()
          continue
        }
        s = must(r)
        expect(kairosStageStateSchema.safeParse(s).success).toBe(true)
        expect(JSON.stringify(s).length).toBeLessThanOrEqual(STAGE_MAX_BYTES)
        if (s.focus) {
          const held = s.coalitions.find((c) => c.id === s.focus!.coalitionId)
          if (held) expect(held.deepBacked).toBe(true)
        }
      }
    },
  )
})
