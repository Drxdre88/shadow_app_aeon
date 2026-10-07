import { describe, expect, it } from 'vitest'
import { DRIFT_PROBE_IDS, DRIFT_PROBES } from '../probes'
import {
  buildConstitutionDraftPrompt,
  buildDriftProbePrompt,
  draftValidIds,
  parseConstitutionDraft,
  parseDriftAnswers,
  type DraftContext,
} from '../prompts'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const D1 = '33333333-3333-4333-8333-333333333333'

const ctx: DraftContext = {
  dominions: [{
    id: D1,
    name: 'Swarm',
    vision: 'Calm, profitable trading',
    missionLong: 'Build an honest signal engine',
    objectives: [{ title: 'Ship v2', description: null, status: 'active' }],
  }],
  reflections: [
    { id: R1, title: 'Honesty beats comfort', summary: 'Say the hard thing' },
    { id: R2, title: 'Rest matters', summary: null },
  ],
}

const fence = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

describe('constitution draft prompt', () => {
  it('lists every Dominion and reflection id for citation', () => {
    const prompt = buildConstitutionDraftPrompt(ctx)
    for (const id of [D1, R1, R2]) expect(prompt).toContain(`[${id}]`)
    expect(prompt).toContain('Vision: Calm, profitable trading')
    expect(prompt).toContain('(active) Ship v2')
    expect(draftValidIds(ctx)).toEqual([D1, R1, R2])
  })

  it('keeps grounded principles and drops ungrounded ones and citations', () => {
    const out = parseConstitutionDraft(fence({
      principles: [
        { text: 'Tell the truth', reason: 'Trust compounds', citations: [R1, 'made-up'] },
        { text: 'Protect rest', reason: 'Energy is the bottleneck', citations: [R2] },
        { text: 'Serve the vision', reason: 'Focus', citations: [D1] },
        { text: 'Invented value', reason: 'No evidence', citations: ['nope'] },
      ],
      rationale: 'From reflections',
    }), draftValidIds(ctx))
    expect(out.principles.map((p) => p.text)).toEqual(['Tell the truth', 'Protect rest', 'Serve the vision'])
    expect(out.citedIds.sort()).toEqual([D1, R1, R2].sort())
    expect(out.rationale).toBe('From reflections')
  })

  it('rejects a draft with fewer than three grounded principles', () => {
    expect(() => parseConstitutionDraft(fence({
      principles: [{ text: 'A', reason: 'B', citations: [R1] }, { text: 'C', reason: 'D', citations: [] }],
      rationale: '',
    }), draftValidIds(ctx))).toThrow(/at least 3/)
  })
})

describe('drift probe prompt + parser', () => {
  const answers = DRIFT_PROBES.map((p) => ({ probeId: p.id, answer: `Answer to ${p.id}` }))

  it('puts the constitution, beliefs and every probe id in the prompt', () => {
    const prompt = buildDriftProbePrompt({
      version: 2,
      principles: [{ n: 1, text: 'Tell the truth', reason: 'Trust compounds' }],
      beliefs: [{ mind: 'aligned', domain: 'Swarm', claim: 'Edges decay' }],
    })
    expect(prompt).toContain('Constitution v2')
    expect(prompt).toContain('Tell the truth')
    expect(prompt).toContain('(aligned mind · Swarm) Edges decay')
    for (const id of DRIFT_PROBE_IDS) expect(prompt).toContain(`- ${id}:`)
  })

  it('returns answers in probe order, first answer per id wins, unknown ids ignored', () => {
    const shuffled = [...answers].reverse()
    const out = parseDriftAnswers(fence({
      answers: [{ probeId: 'nature-05', answer: 'first' }, ...shuffled, { probeId: 'bogus', answer: 'x' }],
    }))
    expect(out.map((a) => a.probeId)).toEqual([...DRIFT_PROBE_IDS])
    expect(out.find((a) => a.probeId === 'nature-05')?.answer).toBe('first')
  })

  it('rejects a reply that skips a probe', () => {
    expect(() => parseDriftAnswers(fence({ answers: answers.slice(1) }))).toThrow(/missing answers for priorities-01/)
  })

  it('rejects malformed JSON', () => {
    expect(() => parseDriftAnswers('no json here')).toThrow()
  })
})
