import { describe, expect, it } from 'vitest'
import {
  IDEA_GENERATE_SYSTEM_PROMPT,
  buildIdeaGeneratePrompt,
  parseIdeaGenerateText,
  spliceBeforeDataEnd,
  type IdeaGenerateInputs,
} from '../generate-prompt'
import { readJudgeContext, type IdeaJudgeContext } from '../judge-context'
import { renderIdeaBody } from '../compose'
import { IDEA_DATA_BEGIN, IDEA_DATA_END } from '../prompt-data'
import { IDEA_CANDIDATES_MAX } from '../types'

const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

const inputs: IdeaGenerateInputs = {
  date: '2026-10-01',
  dominions: [{ id: 'dom-1', name: 'Aeon' }],
  objectives: [],
  aether: null,
  board: [{ id: 'board-1', title: 'Board day', summary: 'finished 3', excerpt: null, dominionId: 'dom-1' }],
  beliefs: [],
  concepts: [],
  reflections: [],
  lessons: [{ title: 'Old', direction: 'x', claim: 'c', outcome: 'accepted' }],
  directionStats: [],
}

const directions = [
  { id: 'd1', label: 'Stop', move: 'stop', dominion: 'Aeon' },
  { id: 'd2', label: 'Test', move: 'test', dominion: null },
]
const cand = (title: string, evidenceIds: string[], direction = 'd1', extra: Record<string, unknown> = {}) =>
  ({ direction, title, claim: `${title} claim`, why: 'why', nextStep: 'step', evidenceIds, ...extra })
const VALID = new Set(['refl-1', 'board-1'])
const answer = json({
  directions,
  candidates: [cand('Alpha', ['refl-1'], 'd1', { p: 0.05 }), cand('Beta', ['board-1'], 'd2'), cand('Gamma', ['bogus']), cand('Delta', ['refl-1'], 'd9')],
})

describe('spliceBeforeDataEnd', () => {
  it('puts the section last inside the data block, keeping everything else', () => {
    const base = buildIdeaGeneratePrompt(inputs)
    const out = spliceBeforeDataEnd(base, '## Extra\n- one')
    expect(out).toContain(`## Extra\n- one\n\n${IDEA_DATA_END}\n`)
    expect(out.indexOf('## Extra')).toBeGreaterThan(out.indexOf(IDEA_DATA_BEGIN))
    expect(out.indexOf('## Extra')).toBeLessThan(out.indexOf(IDEA_DATA_END))
    expect(out.replace('\n## Extra\n- one\n', '')).toBe(base)
  })

  it('stacks two splices in call order', () => {
    const out = spliceBeforeDataEnd(spliceBeforeDataEnd(buildIdeaGeneratePrompt(inputs), '## Lane one'), '## Lane two')
    expect(out.indexOf('## Lane one')).toBeLessThan(out.indexOf('## Lane two'))
    expect(out.indexOf('## Lane two')).toBeLessThan(out.indexOf(IDEA_DATA_END))
  })

  it('throws unless the end marker occurs exactly once', () => {
    expect(() => spliceBeforeDataEnd('no marker here', '## X')).toThrow(/exactly once/)
    const twice = `a\n${IDEA_DATA_END}\nb\n${IDEA_DATA_END}\nc`
    expect(() => spliceBeforeDataEnd(twice, '## X')).toThrow(/exactly once/)
  })

  it('the unchanged system prompt is still the constant', () => {
    expect(IDEA_GENERATE_SYSTEM_PROMPT).toContain('Output ONLY this JSON object')
  })
})

describe('parseIdeaGenerateText options', () => {
  it('without options the result is unchanged and carries no raw', () => {
    const plain = parseIdeaGenerateText(answer, VALID)
    expect(parseIdeaGenerateText(answer, VALID, undefined)).toEqual(plain)
    expect(plain).not.toHaveProperty('raw')
    expect(plain.candidates.map((c) => c.key)).toEqual(['c1', 'c2'])
    expect(Object.keys(plain.candidates[0])).toEqual(['key', 'direction', 'title', 'claim', 'why', 'nextStep', 'citedIds'])
    expect(plain.dropped).toEqual({ ungrounded: 1, unknownDirection: 1, overCap: 0 })
  })

  it('empty options parse to the same result', () => {
    expect(parseIdeaGenerateText(answer, VALID, {})).toEqual(parseIdeaGenerateText(answer, VALID))
  })

  it('extendCandidate sees the raw item and the direction; keepRaw keeps the JSON', () => {
    const seen: unknown[] = []
    const out = parseIdeaGenerateText(answer, VALID, {
      keepRaw: true,
      extendCandidate: (rawItem, built, direction) => {
        seen.push(rawItem)
        const p = (rawItem as { p?: number }).p
        return { ...built, move: direction.move, ...(p !== undefined ? { likelihood: p } : {}) }
      },
    })
    expect(out.candidates.map((c) => [c.key, c.move, c.likelihood])).toEqual([['c1', 'stop', 0.05], ['c2', 'test', undefined]])
    expect((seen[0] as { title: string }).title).toBe('Alpha')
    expect((out.raw as { directions: unknown[] }).directions).toHaveLength(2)
  })

  it('skipCap collects every grounded candidate for postProcess, then caps and re-keys', () => {
    const many = json({ directions, candidates: Array.from({ length: 20 }, (_, i) => cand(`T${i}`, ['refl-1'])) })
    let seenCount = 0
    const out = parseIdeaGenerateText(many, VALID, {
      skipCap: true,
      postProcess: (cands, info) => {
        seenCount = cands.length
        expect(info.directions.map((d) => d.move)).toEqual(['stop', 'test'])
        return [...cands].reverse()
      },
    })
    expect(seenCount).toBe(20)
    expect(out.candidates).toHaveLength(IDEA_CANDIDATES_MAX)
    expect(out.candidates[0]).toMatchObject({ key: 'c1', title: 'T19' })
    expect(out.dropped.overCap).toBe(4)
  })

  it('postProcess returning nothing fails like an ungrounded answer', () => {
    expect(() => parseIdeaGenerateText(answer, VALID, { postProcess: () => [] })).toThrow(/no candidate/)
  })
})

const baseCtx = (): IdeaJudgeContext => ({
  date: '2026-10-01',
  generateJobId: 'job-gen',
  candidates: [{
    key: 'c1', direction: 'Stop', title: 'Alpha', claim: 'a', why: 'w', nextStep: 'n', citedIds: ['refl-1'],
    novelty: { class: 'novel', maxCosine: 0.2, nearestId: null, nearestKind: null },
    evidenceIds: ['refl-1'], vector: null,
  }],
  evidence: { 'refl-1': { id: 'refl-1', title: 't', text: 'x', origin: 'operator', dominionId: null } },
  nearest: {},
  pairs: [],
  matches: [],
})

describe('judge context lane fields', () => {
  it('a flag-off context reads back deep-equal with no new keys', () => {
    const ctx = baseCtx()
    const read = readJudgeContext(JSON.parse(JSON.stringify(ctx)))
    expect(read).toEqual(ctx)
    expect(Object.keys(read!)).toEqual(Object.keys(ctx))
    expect(Object.keys(read!.candidates[0])).toEqual(Object.keys(ctx.candidates[0]))
  })

  it('lane fields survive readJudgeContext', () => {
    const ctx = baseCtx()
    const bridge = { v: 1, pairKey: 'a|b', aId: 'a', bId: 'b', aArea: null, bArea: null, cos: 0.3, relations: [], map: [], insight: 'i', mappingHolds: null }
    const laned = {
      ...ctx,
      candidates: [{ ...ctx.candidates[0], kind: 'experiment', leap: 'far', blend: 'p1', bridge, move: 'test', likelihood: 0.04, lens: null, atlas: { cell: 'x' } }],
      atlas: { holders: [] },
      swiss: { round: 1 },
      ext: { anything: true },
    }
    expect(readJudgeContext(laned)).toEqual(laned)
  })

  it('rejects an out-of-vocabulary kind', () => {
    const ctx = baseCtx()
    expect(readJudgeContext({ ...ctx, candidates: [{ ...ctx.candidates[0], kind: 'vibe' }] })).toBeNull()
  })
})

describe('renderIdeaBody extra lines', () => {
  const body = { direction: 'Stop', claim: 'a', why: 'w', nextStep: 'n', evidenceIds: [], survivedBecause: 'because' }
  it('no or empty extra lines leave the body unchanged; lines are appended last', () => {
    const plain = renderIdeaBody(body, new Map())
    expect(renderIdeaBody({ ...body, extraLines: [] }, new Map())).toBe(plain)
    expect(renderIdeaBody({ ...body, extraLines: ['**Collision.** A ↔ B'] }, new Map())).toBe(`${plain}\n\n**Collision.** A ↔ B`)
  })
})
