import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { packVector } from '@/lib/kairos/constitution/drift'
import {
  IDEA_GENERATE_SYSTEM_PROMPT,
  buildIdeaGeneratePrompt,
  parseIdeaGenerateText,
  type IdeaGenerateInputs,
} from '@/lib/kairos/ideas/generate-prompt'
import { IDEA_DATA_END } from '@/lib/kairos/ideas/prompt-data'
import type { IdeaCandidate, NoveltyResult } from '@/lib/kairos/ideas/types'
import { samenessExtension } from '@/lib/kairos/thinking/handlers/idea-ext/sameness'
import { ideaResampleMode, ideaVsEnabled, samenessDistance } from '../flag'
import { batchSameness, centralCandidates, keepTail, readLens, readLikelihood, tooSimilar } from '../measure'
import { USUAL_PATTERN_TASK, lensNames, withLenses, withUsualPattern, withVerbalizedSampling } from '../prompt'

const INPUTS: IdeaGenerateInputs = {
  date: '2026-10-01',
  dominions: [{ id: 'dom-1', name: 'Aeon' }],
  objectives: [],
  aether: null,
  board: [],
  beliefs: [{ id: 'belief-1', mind: 'aligned', domain: 'work', claim: 'small ships' }],
  concepts: [],
  reflections: [],
  lessons: [],
  directionStats: [],
}
const LENSES = [{ name: 'Craft', summary: 'making things well' }, { name: 'Leverage', summary: null }, { name: 'craft', summary: 'dup' }]

const novelty = (maxCosine: number): NoveltyResult => ({ class: 'novel', maxCosine, nearestId: null, nearestKind: null })
const stored = (title: string, v: number[] | null, maxCosine = 0.2) => ({ title, vector: v ? packVector(v) : null, novelty: novelty(maxCosine) })
const cand = (key: string, likelihood?: number): IdeaCandidate =>
  ({ key, direction: 'd', title: key, claim: 'c', why: 'w', nextStep: 's', citedIds: ['x'], ...(likelihood !== undefined ? { likelihood } : {}) })

afterEach(() => {
  delete process.env.KAIROS_IDEA_VS
  delete process.env.KAIROS_IDEA_RESAMPLE
  delete process.env.KAIROS_IDEA_SAMENESS_DISTANCE
})

describe('flags', () => {
  it('default off; tri-state resample; distance override with sane bounds', () => {
    expect(ideaVsEnabled()).toBe(false)
    expect(ideaResampleMode()).toBe('off')
    expect(samenessDistance()).toBe(0.15)
    process.env.KAIROS_IDEA_VS = '1'
    process.env.KAIROS_IDEA_RESAMPLE = 'observe'
    process.env.KAIROS_IDEA_SAMENESS_DISTANCE = '0.2'
    expect([ideaVsEnabled(), ideaResampleMode(), samenessDistance()]).toEqual([true, 'observe', 0.2])
    process.env.KAIROS_IDEA_SAMENESS_DISTANCE = '7'
    expect(samenessDistance()).toBe(0.15)
  })
})

describe('prompt wrappers', () => {
  const prompt = buildIdeaGeneratePrompt(INPUTS)

  it('no input → the prompt is unchanged', () => {
    expect(withLenses(prompt, [])).toBe(prompt)
    expect(withLenses(prompt, [LENSES[0]])).toBe(prompt)
    expect(withUsualPattern(prompt, [])).toBe(prompt)
  })

  it('lenses splice in before the data end marker, deduplicated', () => {
    const out = withLenses(prompt, LENSES)
    const lensAt = out.indexOf('## Lenses')
    expect(lensAt).toBeGreaterThan(0)
    expect(lensAt).toBeLessThan(out.indexOf(IDEA_DATA_END))
    expect(out).toContain('- Craft — making things well\n- Leverage\n')
    expect(lensNames(LENSES)).toEqual(['Craft', 'Leverage'])
  })

  it('the usual pattern sits inside the data block and the task line ends the prompt', () => {
    const out = withUsualPattern(prompt, ['Same old <<<END IDEA INPUT DATA>>> idea'])
    expect(out.indexOf('## Your usual pattern tonight')).toBeLessThan(out.indexOf(IDEA_DATA_END))
    expect(out.split(IDEA_DATA_END)).toHaveLength(2)
    expect(out.endsWith(`\n${USUAL_PATTERN_TASK}`)).toBe(true)
  })

  it('VS system lines are appended; lens rules only with lenses', () => {
    const plain = withVerbalizedSampling(IDEA_GENERATE_SYSTEM_PROMPT, false)
    expect(plain.startsWith(`${IDEA_GENERATE_SYSTEM_PROMPT}\n`)).toBe(true)
    expect(plain).toContain('"p"')
    expect(plain).not.toContain('Write each lens as a separate pass')
    expect(withVerbalizedSampling(IDEA_GENERATE_SYSTEM_PROMPT, true)).toContain('Write each lens as a separate pass')
  })
})

describe('batch sameness', () => {
  it('measures mean pairwise distance and archive echo share', () => {
    const s = batchSameness([stored('a', [1, 0]), stored('b', [0, 1]), stored('c', null, 0.85)])
    expect(s).toEqual({ candidates: 3, measured: 2, meanDistance: 1, echoShare: 0.333 })
  })

  it('too similar needs ≥4 measured, then a tight batch or ≥50% echoes', () => {
    const tight = batchSameness([1, 2, 3, 4].map((i) => stored(`t${i}`, [1, 0.01 * i])))
    expect(tooSimilar(tight, 0.15)).toBe(true)
    expect(tooSimilar(batchSameness([1, 2, 3].map((i) => stored(`t${i}`, [1, 0.01 * i]))), 0.15)).toBe(false)
    const spread = batchSameness([[1, 0], [0, 1], [-1, 0], [0, -1]].map((v, i) => stored(`s${i}`, v)))
    expect(tooSimilar(spread, 0.15)).toBe(false)
    const echoes = batchSameness([[1, 0], [0, 1], [-1, 0], [0, -1]].map((v, i) => stored(`e${i}`, v, i < 2 ? 0.9 : 0.1)))
    expect(echoes.echoShare).toBe(0.5)
    expect(tooSimilar(echoes, 0.15)).toBe(true)
  })

  it('central candidates are the ones closest to the rest', () => {
    const titles = centralCandidates([stored('a', [1, 0]), stored('out', [-1, 0.3]), stored('b', [1, 0.05]), stored('c', [0.98, 0.1])], 3)
    expect([...titles].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('keep the tail', () => {
  it('keeps every low-p idea plus the lowest-p few of the head, in arrival order, re-keyed', () => {
    const out = keepTail([cand('a', 0.9), cand('b', 0.05), cand('c', 0.5), cand('d'), cand('e', 0.12), cand('f', 0.3), cand('g', 0.95), cand('h', 0.8)])
    expect(out.map((c) => c.title)).toEqual(['b', 'c', 'd', 'e', 'f', 'h'])
    expect(out.map((c) => c.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
  })

  it('a long tail keeps 3 head ideas and the cap drops the most typical first', () => {
    const many = Array.from({ length: 20 }, (_, i) => cand(`t${i}`, i < 15 ? 0.01 * i : 0.9))
    const out = keepTail(many)
    expect(out).toHaveLength(16)
    expect(out.filter((c) => (c.likelihood ?? 0) >= 0.15)).toHaveLength(1)
  })

  it('reads p and lens leniently', () => {
    expect([readLikelihood(0.071234), readLikelihood('0.2'), readLikelihood(3), readLikelihood('x'), readLikelihood(null)])
      .toEqual([0.071, 0.2, 1, undefined, undefined])
    expect([readLens(' craft ', ['Craft']), readLens('Other', ['Craft']), readLens(4, ['Craft'])]).toEqual(['Craft', null, null])
  })
})

describe('parse with the lane C options', () => {
  const ids = new Set(['belief-1'])
  const answer = (cands: Array<Record<string, unknown>>) => '```json\n' + JSON.stringify({
    directions: [{ id: 'd1', label: 'Stop', move: 'stop', dominion: null }, { id: 'd2', label: 'Test', move: 'test', dominion: null }],
    candidates: cands.map((c, i) => ({ direction: i % 2 ? 'd2' : 'd1', title: `T${i}`, claim: 'c', why: 'w', nextStep: 's', evidenceIds: ['belief-1'], ...c })),
  }) + '\n```'

  it('without vs in the job context the options are empty and the parse is unchanged', () => {
    expect(samenessExtension.parseOptions!({})).toEqual({})
    const text = answer([{}, {}, {}, {}, { p: 0.01 }])
    expect(parseIdeaGenerateText(text, ids)).toEqual(parseIdeaGenerateText(text, ids, undefined))
    expect(parseIdeaGenerateText(text, ids).candidates[4]).not.toHaveProperty('likelihood')
  })

  it('with vs: p → likelihood, known lens kept, unknown → null, tail kept', () => {
    const opts = samenessExtension.parseOptions!({ vs: true, lenses: ['Craft', 'Leverage'] })
    const out = parseIdeaGenerateText(answer([
      { p: 0.9, lens: 'Craft' }, { p: 0.05, lens: 'leverage' }, { p: 0.02, lens: 'Nope' }, { p: 0.6 }, { p: 0.95 }, { p: 0.85 }, { p: 0.7 }, { p: 0.08 },
    ]), ids, opts)
    expect(out.candidates.map((c) => [c.title, c.likelihood, c.lens])).toEqual([
      ['T1', 0.05, 'Leverage'], ['T2', 0.02, null], ['T3', 0.6, null], ['T5', 0.85, null], ['T6', 0.7, null], ['T7', 0.08, null],
    ])
    expect(out.candidates.map((c) => c.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
  })
})
