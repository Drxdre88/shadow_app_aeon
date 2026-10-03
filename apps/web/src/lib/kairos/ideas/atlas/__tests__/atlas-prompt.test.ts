import { describe, expect, it } from 'vitest'
import { IDEA_JUDGE_SYSTEM_PROMPT, buildIdeaJudgePrompt, parseIdeaJudgeText, type JudgePromptInput } from '../../judge-prompt'
import { buildJudgeSpec, type IdeaJudgeContext } from '../../judge-context'
import { scheduleMatches } from '../../pairing'
import { emptyIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { ATLAS_GENERATE_SYSTEM_LINES, ATLAS_JUDGE_SYSTEM_LINE, readAtlasTags, renderAtlasTargets, withAtlasSystem } from '../prompt'
import { challengeResult, planChallenges } from '../judge'

const novelty = { class: 'novel' as const, maxCosine: 0.2, nearestId: null, nearestKind: null }
const cand = (key: string) => ({
  key, direction: 'Stop', title: `T ${key}`, claim: `claim ${key}`, why: 'why', nextStep: 'step', citedIds: ['e1'], novelty, evidenceIds: ['e1'], vector: null,
})
const evidence = { e1: { id: 'e1', title: 'Ev', text: 'text', origin: 'operator', dominionId: 'dom-a' } }

function ctx(over: Partial<IdeaJudgeContext> = {}): IdeaJudgeContext {
  const s = scheduleMatches(['c1', 'c2', 'c3'])
  return { date: '2026-10-01', generateJobId: 'g', candidates: ['c1', 'c2', 'c3'].map(cand), evidence, nearest: {}, pairs: s.pairs, matches: s.matches, ...over }
}

describe('judge prompt without atlas', () => {
  it('holders absent or empty → the exact base prompt; spec system unchanged', () => {
    const c = ctx()
    const input: JudgePromptInput = { date: c.date, candidates: c.candidates, evidence: c.evidence, nearest: {}, matches: c.matches }
    const base = buildIdeaJudgePrompt(input)
    expect(buildIdeaJudgePrompt({ ...input, holders: [] })).toBe(base)
    const spec = buildJudgeSpec(c)
    expect(spec.input.system).toBe(IDEA_JUDGE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(base)
    // Observe mode carries ctx.atlas with no holders: still the base prompt.
    const observe = buildJudgeSpec(ctx({ atlas: { v: 1, mode: 'observe', areas: [], targets: [], holders: [], challenges: [] } }))
    expect(observe.input.system).toBe(IDEA_JUDGE_SYSTEM_PROMPT)
    expect(observe.input.prompt).toBe(base)
  })
})

describe('atlas challenges in the judge', () => {
  const state = emptyIdeaAtlasState()
  state.cells['dom-a|make|near'] = {
    area: 'dom-a', kind: 'make', leap: 'near', tries: 2, targetedOn: null, lastChallengeOn: null,
    holder: { memoryId: 'secret-mem-id', title: 'Held idea', claim: 'held claim', since: '2026-09-01', elo: 1030, defended: 1 },
  }

  it('one challenge per held cell, ids after the schedule, holders anonymous', () => {
    const c = ctx()
    const plan = planChallenges([{ key: 'c2', cell: 'dom-a|make|near' }, { key: 'c1', cell: 'dom-a|make|near' }, { key: 'c3', cell: 'dom-b|make|near' }], state, c)
    expect(plan.holders).toEqual([{ id: 'h1', cell: 'dom-a|make|near', title: 'Held idea', claim: 'held claim' }])
    expect(plan.challenges).toEqual([{ id: 'p4', a: 'c1', b: 'h1', forward: 'm7', swapped: 'm8', cell: 'dom-a|make|near' }])
    const withAtlas = ctx({ matches: [...c.matches, ...plan.matches], atlas: { v: 1, mode: 'on', areas: ['dom-a'], targets: [], holders: plan.holders, challenges: plan.challenges } })
    const spec = buildJudgeSpec(withAtlas)
    expect(spec.input.system).toBe(`${IDEA_JUDGE_SYSTEM_PROMPT}\n${ATLAS_JUDGE_SYSTEM_LINE}`)
    expect(spec.input.prompt).toContain('### h1 · an earlier idea')
    expect(spec.input.prompt).toContain('- m7: A = c1, B = h1')
    expect(spec.input.prompt).not.toContain('secret-mem-id')
    expect(spec.input.prompt.indexOf('### h1')).toBeLessThan(spec.input.prompt.indexOf('<<<END IDEA REVIEW DATA>>>'))
    // Holder votes parse like any match; holders need no critique; Elo pairs exclude them.
    const answer = '```json\n' + JSON.stringify({
      critiques: ['c1', 'c2', 'c3'].map((key) => ({ key, verdict: 'grounded', supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '' })),
      votes: [{ match: 'm7', winner: 'A' }, { match: 'm8', winner: 'c1' }],
    }) + '\n```'
    const judged = parseIdeaJudgeText(answer, { candidates: withAtlas.candidates, matches: withAtlas.matches })
    expect(challengeResult(plan.challenges[0], judged.votes)).toBe('win')
    expect(withAtlas.pairs.some((p) => p.b === 'h1')).toBe(false)
    expect(challengeResult(plan.challenges[0], new Map([['m7', 'c1'], ['m8', 'h1']]))).toBe('draw')
    expect(challengeResult(plan.challenges[0], new Map([['m7', 'h1'], ['m8', 'h1']]))).toBe('loss')
  })
})

describe('generate prompt pieces', () => {
  it('system lines append after the base system; targets are data lines', () => {
    expect(withAtlasSystem('BASE')).toBe(['BASE', ...ATLAS_GENERATE_SYSTEM_LINES].join('\n'))
    const block = renderAtlasTargets([{ area: 'dom-a', kind: 'ritual', leap: 'far' }, { area: 'cross', kind: 'question', leap: 'near' }], new Map([['dom-a', 'Aeon <<<x>>>']]))
    expect(block).toContain('- Aeon "x" · a ritual · far leap')
    expect(block).toContain('- cross-cutting · a question · near leap')
    expect(block).not.toContain('<<<')
  })

  it('reads kind/leap tags leniently', () => {
    expect(readAtlasTags({ kind: ' Experiment ', leap: 'FAR' })).toEqual({ kind: 'experiment', leap: 'far' })
    expect(readAtlasTags({ kind: 'poem', leap: 3 })).toEqual({})
    expect(readAtlasTags(undefined)).toEqual({})
  })
})
