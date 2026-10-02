import { describe, expect, it } from 'vitest'
import {
  VOICE_NOTE_EXCERPT_MAX,
  VOICE_NOTE_SEGMENT_MAX,
  VOICE_NOTE_SEGMENT_MIN,
  groupVoiceNoteProposals,
  readVoiceNote,
  splitTranscript,
  verbatimExcerpt,
  voiceNoteTitle,
} from '../voice-note'

const sentence = (i: number) => `Sentence number ${i} says something worth keeping about the plan.`
const paragraph = (from: number, count: number) => Array.from({ length: count }, (_, k) => sentence(from + k)).join(' ')
const squash = (s: string) => s.replace(/\s+/g, '')

describe('splitTranscript', () => {
  it('keeps a short note as one verbatim segment', () => {
    expect(splitTranscript('  Hello Kairos. Short one.\r\n')).toEqual(['Hello Kairos. Short one.'])
  })

  it('returns nothing for a blank transcript', () => {
    expect(splitTranscript(' \n\t ')).toEqual([])
  })

  it('cuts at paragraph breaks inside the window and stays verbatim', () => {
    const paras = Array.from({ length: 6 }, (_, i) => paragraph(i * 100, 10))
    const text = paras.join('\n\n')
    const parts = splitTranscript(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts.slice(0, -1)) {
      expect(p.length).toBeGreaterThanOrEqual(VOICE_NOTE_SEGMENT_MIN)
      expect(p.length).toBeLessThanOrEqual(VOICE_NOTE_SEGMENT_MAX)
      expect(paras).toContain(p.split('\n\n').at(-1))
    }
    expect(squash(parts.join(''))).toBe(squash(text))
  })

  it('falls back to sentence ends when a paragraph is longer than the max', () => {
    const text = paragraph(0, 120)
    const parts = splitTranscript(text)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(VOICE_NOTE_SEGMENT_MAX)
    for (const p of parts.slice(0, -1)) {
      expect(p.length).toBeGreaterThanOrEqual(VOICE_NOTE_SEGMENT_MIN)
      expect(p.endsWith('plan.')).toBe(true)
    }
    expect(parts.join(' ')).toBe(text)
  })

  it('falls back to word breaks, then a hard cut, with no punctuation at all', () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')
    const wordParts = splitTranscript(words)
    for (const p of wordParts) expect(p.length).toBeLessThanOrEqual(VOICE_NOTE_SEGMENT_MAX)
    expect(wordParts.join(' ')).toBe(words)

    const blob = 'x'.repeat(4_000)
    const blobParts = splitTranscript(blob)
    expect(blobParts.map((p) => p.length)).toEqual([1_800, 1_800, 400])
  })

  it('handles the 100k ceiling without losing text', () => {
    const text = Array.from({ length: 160 }, (_, i) => paragraph(i * 10, 10)).join('\n\n').slice(0, 100_000)
    const parts = splitTranscript(text)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(VOICE_NOTE_SEGMENT_MAX)
    expect(squash(parts.join(''))).toBe(squash(text.trim()))
  })
})

describe('verbatimExcerpt', () => {
  it('is the first sentence word for word', () => {
    expect(verbatimExcerpt('I think we ship Friday.  Then rest.')).toBe('I think we ship Friday.')
    expect(verbatimExcerpt('Is it worth it?\nMaybe.')).toBe('Is it worth it?')
    expect(verbatimExcerpt('No punctuation\nat all')).toBe('No punctuation at all')
  })

  it('cuts a long sentence at a word boundary and marks it', () => {
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ')
    const out = verbatimExcerpt(long)
    expect(out.length).toBeLessThanOrEqual(VOICE_NOTE_EXCERPT_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(long.startsWith(out.slice(0, -1))).toBe(true)
  })
})

describe('voiceNoteTitle / readVoiceNote', () => {
  it('numbers parts only when there are several', () => {
    expect(voiceNoteTitle(2, 3, 'Ship it.')).toBe('Voice note 2/3: Ship it.')
    expect(voiceNoteTitle(1, 1, 'Ship it.')).toBe('Voice note: Ship it.')
  })

  it('reads the ref and rejects malformed metadata', () => {
    expect(readVoiceNote({ voiceNote: { noteId: 'n', part: 1, of: 2, hash: 'h' } })).toEqual({ noteId: 'n', part: 1, of: 2 })
    expect(readVoiceNote({ voiceNote: { noteId: 'n' } })).toBeNull()
    expect(readVoiceNote(null)).toBeNull()
  })
})

describe('groupVoiceNoteProposals', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 9, m))
  const seg = (id: string, noteId: string, part: number, of: number) => ({
    kind: 'proposal', id, title: `t${id}`, summary: `s${id}`, createdAt: at(part), voiceNote: { noteId, part, of },
  })

  it('collapses one note into a single entry in part order, leaving other items in place', () => {
    const ask = { kind: 'ask', id: 'a', title: 'q', createdAt: at(0) }
    const plain = { kind: 'proposal', id: 'p', title: 'idea', summary: null, createdAt: at(5) }
    const out = groupVoiceNoteProposals([ask, seg('s2', 'N', 2, 3), plain, seg('s1', 'N', 1, 3), seg('s3', 'N', 3, 3), seg('x1', 'M', 1, 1)])
    expect(out.map((i) => i.kind)).toEqual(['ask', 'voice_note', 'proposal', 'voice_note'])
    const group = out[1]
    if (group.kind !== 'voice_note' || !('noteId' in group)) throw new Error('expected a group')
    expect(group).toMatchObject({ noteId: 'N', parts: 3, pendingIds: ['s1', 's2', 's3'], title: 'Voice note · 3 parts', summary: 'ss1' })
    expect(group.createdAt).toEqual(at(1))
    expect(out[3]).toMatchObject({ noteId: 'M', parts: 1, title: 'Voice note', pendingIds: ['x1'] })
  })

  it('reports fewer pending ids than parts once some were accepted one by one', () => {
    const [group] = groupVoiceNoteProposals([seg('s3', 'N', 3, 3)])
    expect(group).toMatchObject({ parts: 3, pendingIds: ['s3'] })
  })
})
