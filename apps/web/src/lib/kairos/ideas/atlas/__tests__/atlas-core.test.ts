import { describe, expect, it } from 'vitest'
import { emptyIdeaAtlasState, kairosIdeaAtlasStateSchema, type KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { ATLAS_CROSS_AREA, allCells, cellKey, parseCellKey, tagCandidate, verifyLeap } from '../cells'
import { applyAtlasNight, decideAtlasNight, type AtlasNightEntry } from '../update'
import { pickAtlasTargets } from '../targets'
import { renderIdeaAtlasMarkdown, toIdeaAtlasView } from '../view'
import { ideaAtlasMode, ideaSwissEnabled, ideaSwissRounds } from '../flag'

const DAY = '2026-10-01'
const DOMS = [{ id: 'dom-a', name: 'Aeon' }, { id: 'dom-b', name: 'Health' }]
const evidence = new Map([
  ['e-a1', { dominionId: 'dom-a' }],
  ['e-a2', { dominionId: 'dom-a' }],
  ['e-b1', { dominionId: 'dom-b' }],
  ['e-x', { dominionId: null }],
])
const tagCtx = { evidence, directions: [{ label: 'Stop', dominion: 'health' }, { label: 'Free', dominion: null }], dominions: DOMS }

describe('flags', () => {
  it('default off; parse modes and clamp rounds', () => {
    const env = { ...process.env }
    delete process.env.KAIROS_IDEA_ATLAS
    delete process.env.KAIROS_IDEA_SWISS
    delete process.env.KAIROS_IDEA_SWISS_ROUNDS
    expect([ideaAtlasMode(), ideaSwissEnabled(), ideaSwissRounds()]).toEqual(['off', false, 5])
    process.env.KAIROS_IDEA_ATLAS = 'observe'
    process.env.KAIROS_IDEA_SWISS = '1'
    process.env.KAIROS_IDEA_SWISS_ROUNDS = '9'
    expect([ideaAtlasMode(), ideaSwissEnabled(), ideaSwissRounds()]).toEqual(['observe', true, 6])
    process.env.KAIROS_IDEA_ATLAS = 'on'
    process.env.KAIROS_IDEA_SWISS_ROUNDS = '1'
    expect([ideaAtlasMode(), ideaSwissRounds()]).toEqual(['on', 3])
    process.env = env
  })
})

describe('cells', () => {
  it('keys round-trip and the grid covers areas + cross', () => {
    expect(parseCellKey(cellKey('dom-a', 'ritual', 'far'))).toEqual({ area: 'dom-a', kind: 'ritual', leap: 'far' })
    expect(parseCellKey('dom-a|nope|far')).toBeNull()
    expect(allCells(['dom-a'])).toHaveLength(20)
    expect(allCells([]).every((c) => c.area === ATLAS_CROSS_AREA)).toBe(true)
  })

  it('area = majority Dominion of cited evidence, else the direction\'s declared Dominion, else cross', () => {
    const base = { kind: 'make' as const, leap: 'near' as const, direction: 'Stop', maxCosine: 0.7 }
    expect(tagCandidate({ ...base, citedIds: ['e-a1', 'e-a2', 'e-b1'] }, tagCtx)?.area).toBe('dom-a')
    expect(tagCandidate({ ...base, citedIds: ['e-x'] }, tagCtx)?.area).toBe('dom-b')
    expect(tagCandidate({ ...base, direction: 'Free', citedIds: ['e-x'] }, tagCtx)?.area).toBe(ATLAS_CROSS_AREA)
    expect(tagCandidate({ ...base, kind: undefined, citedIds: ['e-a1'] }, tagCtx)).toBeNull()
  })

  it('a claimed far leap needs ≥2 Dominions or a distant idea; unclaimed is near', () => {
    expect(verifyLeap('far', 2, 0.9)).toBe('far')
    expect(verifyLeap('far', 1, 0.59)).toBe('far')
    expect(verifyLeap('far', 1, 0.6)).toBe('near')
    expect(verifyLeap(null, 3, 0.1)).toBe('near')
    const tag = tagCandidate({ kind: 'question', leap: 'far', citedIds: ['e-a1'], direction: 'Stop', maxCosine: 0.75 }, tagCtx)
    expect(tag).toEqual({ cell: 'dom-a|question|near', area: 'dom-a', kind: 'question', leap: 'near', leapClaimed: 'far' })
  })
})

const entry = (key: string, cell: string, over: Partial<AtlasNightEntry> = {}): AtlasNightEntry =>
  ({ key, cell, viable: true, elo: 1000, wins: 0, ...over })

function held(cell: string): KairosIdeaAtlasState {
  const ref = parseCellKey(cell)!
  return {
    ...emptyIdeaAtlasState(),
    cells: { [cell]: { ...ref, holder: { memoryId: 'old', title: 'Old', claim: 'old claim', since: '2026-09-01', elo: 1010, defended: 0 }, tries: 1, targetedOn: null, lastChallengeOn: null } },
  }
}

describe('decideAtlasNight / applyAtlasNight', () => {
  const C = 'dom-a|make|near'
  const holders = new Map([['c1', { memoryId: 'm1', title: 'T1', claim: 'claim 1', elo: 1020 }], ['c2', { memoryId: 'm2', title: 'T2', claim: 'claim 2', elo: 990 }]])

  it('an empty cell goes to the best viable by Elo (ranked_out counts as viable)', () => {
    const entries = [entry('c1', C, { elo: 1010 }), entry('c2', C, { elo: 1030, viable: false }), entry('c3', C, { elo: 1020 })]
    const d = decideAtlasNight(emptyIdeaAtlasState(), DAY, entries, [], 'observe')
    expect([...d.took]).toEqual([['c3', 'filled']])
    expect(d.tries.get(C)).toBe(3)
  })

  it('occupied: only a both-orders win replaces (on); draw/loss defends; observe never replaces', () => {
    const state = held(C)
    const entries = [entry('c1', C)]
    expect([...decideAtlasNight(state, DAY, entries, [{ cell: C, key: 'c1', result: 'win' }], 'on').took]).toEqual([['c1', 'replaced']])
    expect(decideAtlasNight(state, DAY, entries, [{ cell: C, key: 'c1', result: 'draw' }], 'on').defended).toEqual([C])
    expect(decideAtlasNight(state, DAY, entries, [{ cell: C, key: 'c1', result: 'loss' }], 'on').defended).toEqual([C])
    expect(decideAtlasNight(state, DAY, entries, [{ cell: C, key: 'c1', result: 'win' }], 'observe').took.size).toBe(0)
    expect(decideAtlasNight(state, DAY, [entry('c1', C, { viable: false })], [{ cell: C, key: 'c1', result: 'win' }], 'on').took.size).toBe(0)
  })

  it('applies holders, tries, targets and history; the same night again is a no-op', () => {
    const entries = [entry('c1', C, { elo: 1020 }), entry('c2', 'cross|ritual|far')]
    const decision = decideAtlasNight(emptyIdeaAtlasState(), DAY, entries, [], 'on')
    const next = applyAtlasNight(emptyIdeaAtlasState(), { date: DAY, entries, decision, holders, targets: ['dom-b|question|far'], areaIds: ['dom-a', 'dom-b'] })
    expect(kairosIdeaAtlasStateSchema.safeParse(next).success).toBe(true)
    expect(next.cells[C].holder).toMatchObject({ memoryId: 'm1', since: DAY, elo: 1020, defended: 0 })
    expect(next.cells['cross|ritual|far'].holder?.memoryId).toBe('m2')
    expect(next.cells['dom-b|question|far']).toMatchObject({ targetedOn: DAY, holder: null, tries: 0 })
    expect(next.lastNight).toBe(DAY)
    expect(next.history).toEqual([{ date: DAY, filled: 2, replaced: 0, defended: 0, targets: ['dom-b|question|far'], coverage: 0.067 }])
    expect(decideAtlasNight(next, DAY, entries, [], 'on').noop).toBe(true)
  })

  it('a defence bumps the holder and stamps the challenge', () => {
    const entries = [entry('c1', C)]
    const decision = decideAtlasNight(held(C), DAY, entries, [{ cell: C, key: 'c1', result: 'loss' }], 'on')
    const next = applyAtlasNight(held(C), { date: DAY, entries, decision, holders, targets: [], areaIds: ['dom-a'] })
    expect(next.cells[C]).toMatchObject({ lastChallengeOn: DAY, tries: 2, holder: { memoryId: 'old', defended: 1 } })
  })
})

describe('targets', () => {
  it('empty cells only, never-targeted first, then oldest target, then fewest tries; stable per night', () => {
    const state = held('dom-a|make|near')
    state.cells['dom-a|question|near'] = { area: 'dom-a', kind: 'question', leap: 'near', holder: null, tries: 0, targetedOn: '2026-09-01', lastChallengeOn: null }
    const all = pickAtlasTargets(state, [DOMS[0]], DAY, 100)
    expect(all).toHaveLength(19)
    expect(all).not.toContain('dom-a|make|near')
    expect(all[all.length - 1]).toBe('dom-a|question|near')
    expect(pickAtlasTargets(state, [DOMS[0]], DAY)).toEqual(pickAtlasTargets(state, [DOMS[0]], DAY))
    expect(pickAtlasTargets(state, [DOMS[0]], DAY)).toHaveLength(4)
  })
})

describe('view', () => {
  it('hides retired Dominions, lists coverage, never-tried and last targets', () => {
    const state = held('dom-a|make|near')
    state.cells['dom-z|ritual|far'] = { area: 'dom-z', kind: 'ritual', leap: 'far', holder: null, tries: 3, targetedOn: null, lastChallengeOn: null }
    state.history = [{ date: DAY, filled: 1, replaced: 0, defended: 0, targets: ['dom-b|ritual|far'], coverage: 0.03 }]
    const view = toIdeaAtlasView(state, DOMS)
    expect(view.areas.map((a) => a.name)).toEqual(['Aeon', 'Health', 'cross-cutting'])
    expect(view).toMatchObject({ cellsTotal: 30, cellsHeld: 1, coverage: 0.033, lastTargets: ['Health · ritual · far'] })
    expect(view.areas[0].cells.find((c) => c.kind === 'make' && c.leap === 'near')?.holder?.memoryId).toBe('old')
    expect(view.neverTried).not.toContain('Aeon · make · near')
    const md = renderIdeaAtlasMarkdown(view)
    expect(md).toContain('## Aeon (1/10)')
    expect(md).toContain('| make | Old | — |')
    expect(md).not.toContain('dom-z')
  })
})
