import { describe, expect, it } from 'vitest'
import {
  CONCEPT_TITLE_MAX,
  ConceptGroundingError,
  buildConceptPrompt,
  conceptSummary,
  parseConceptText,
  renderConceptMarkdown,
} from '../concept-prompt'

const ids = [
  '11111111-aaaa-4aaa-8aaa-000000000001',
  '22222222-bbbb-4bbb-8bbb-000000000002',
  '33333333-cccc-4ccc-8ccc-000000000003',
  '44444444-dddd-4ddd-8ddd-000000000004',
]

function answer(title: string, bullets: string[]): string {
  return '```json\n' + JSON.stringify({ title, bullets }) + '\n```'
}

describe('buildConceptPrompt', () => {
  it('renders every member with its id and prefers aiTitle, neutralising fences', () => {
    const prompt = buildConceptPrompt({
      dominionName: 'Swarm',
      members: [
        { id: ids[0], title: 'long raw title', aiTitle: 'Short', summary: 'has ``` fence', type: 'note' },
        { id: ids[1], title: 'Raw only', aiTitle: null, summary: null, type: 'idea' },
      ],
    })
    expect(prompt).toContain(`[${ids[0]}] (note) Short — has ''' fence`)
    expect(prompt).toContain(`[${ids[1]}] (idea) Raw only`)
    expect(prompt).not.toContain('long raw title')
    expect(prompt).not.toContain('```')
  })
})

describe('parseConceptText', () => {
  const good = [
    `Alpha holds [${ids[0]}]`,
    `Beta holds [${ids[1]}]`,
    `Gamma holds [${ids[2].slice(0, 8)}]`, // shortened prefix still resolves
    `Delta holds [${ids[3]}, not-an-id]`,
    'Uncited speculation',
  ]

  it('grounds citations to canonical ids and drops uncited bullets', () => {
    const out = parseConceptText(answer('Retry discipline', good), ids)
    expect(out.citedIds).toEqual([...ids].sort())
    expect(out.bullets).toHaveLength(4)
    expect(out.bullets[2]).toBe(`Gamma holds [${ids[2]}]`)
    expect(out.bullets[3]).toBe(`Delta holds [${ids[3]}]`)
  })

  it('rejects when fewer than three members are grounded', () => {
    const bullets = [`a [${ids[0]}]`, `b [${ids[1]}]`, `c [${ids[0]}]`, `d [${ids[1]}]`, 'e [deadbeef-0000]']
    expect(() => parseConceptText(answer('T', bullets), ids)).toThrow(ConceptGroundingError)
  })

  it('rejects out-of-range bullet counts and non-JSON', () => {
    expect(() => parseConceptText(answer('T', good.slice(0, 4)), ids)).toThrow()
    expect(() => parseConceptText('no json here', ids)).toThrow()
  })

  it('clamps the title to the limit', () => {
    const out = parseConceptText(answer('x'.repeat(200), good), ids)
    expect(out.title.length).toBeLessThanOrEqual(CONCEPT_TITLE_MAX)
  })

  it('renders markdown and a citation-free summary', () => {
    const out = parseConceptText(answer('Retry discipline', good), ids)
    expect(renderConceptMarkdown(out)).toMatch(/^# Retry discipline\n\n- Alpha holds \[/)
    expect(conceptSummary(out)).toBe('Retry discipline — Alpha holds')
  })
})
