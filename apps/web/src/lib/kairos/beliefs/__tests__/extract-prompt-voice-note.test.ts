import { describe, expect, it } from 'vitest'
import { buildExtractPrompt, type SignalInputRow } from '../extract-prompt'

const body = Array.from({ length: 60 }, (_, i) => `Clause ${i} of what I said.`).join(' ')
const TAIL = 'Clause 59 of what I said.'

function row(over: Partial<SignalInputRow> = {}): SignalInputRow {
  return {
    id: '11111111-aaaa-4aaa-8aaa-111111111111',
    title: 'Voice note 1/2: Clause 0 of what I said.',
    aiTitle: null,
    summary: 'Clause 0 of what I said.',
    bodyMd: body,
    type: 'reflection',
    kind: 'reflection',
    createdAt: new Date('2026-10-02T09:00:00Z'),
    origin: 'operator',
    voiceNote: true,
    ...over,
  }
}

const prompt = (r: SignalInputRow) => buildExtractPrompt({ dominions: [], held: [], inputs: [r] })

describe('extract prompt — voice notes', () => {
  it('feeds the full body (beyond 500 chars) of a confirmed operator voice-note segment', () => {
    expect(body.length).toBeGreaterThan(1_000)
    expect(prompt(row())).toContain(TAIL)
  })

  it('caps the voice-note body at 2,000 chars', () => {
    const huge = 'word '.repeat(1_000)
    const line = prompt(row({ bodyMd: huge })).split('\n').find((l) => l.includes('the operator wrote'))!
    expect(line.length).toBeLessThan(2_200)
  })

  it('keeps the short excerpt for an unconfirmed (agent) segment and for ordinary reflections', () => {
    expect(prompt(row({ origin: 'agent' }))).not.toContain(TAIL)
    expect(prompt(row({ voiceNote: undefined, summary: null }))).not.toContain(TAIL)
  })
})
