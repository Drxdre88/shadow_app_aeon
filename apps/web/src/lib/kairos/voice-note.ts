// Voice notes (Kairos 0.17): the owner's long dictation from claude.ai, staged
// as pending reflection proposals and counted as the owner's own words only
// after a one-tap confirm in Aeon. Pure and client-safe: chunking, verbatim
// excerpts, metadata reading and inbox grouping. DB writes live in
// lib/data/voice-notes.ts; the confirm path in lib/kairos/voice-note-confirm.ts.

export const VOICE_NOTE_SEGMENT_MIN = 1_200
export const VOICE_NOTE_SEGMENT_MAX = 1_800
export const VOICE_NOTE_EXCERPT_MAX = 240
export const VOICE_NOTE_IDEMPOTENCY_MS = 10 * 60 * 1000

export interface VoiceNoteRef {
  noteId: string
  part: number
  of: number
}

const PARAGRAPH_BREAK = /\n[ \t]*\n\s*/g
const SENTENCE_BREAK = /[.!?…]+["'”’)\]]*\s+/g
const WHITESPACE = /\s+/g

export function normaliseTranscript(transcript: string): string {
  return transcript.replace(/\r\n?/g, '\n').trim()
}

function breakEnds(text: string, re: RegExp): number[] {
  return [...text.matchAll(re)].map((m) => (m.index ?? 0) + m[0].length)
}

function lastIn(ends: readonly number[], lo: number, hi: number): number | null {
  for (let i = ends.length - 1; i >= 0; i--) {
    if (ends[i] <= hi && ends[i] > lo) return ends[i]
  }
  return null
}

export function splitTranscript(
  transcript: string,
  min = VOICE_NOTE_SEGMENT_MIN,
  max = VOICE_NOTE_SEGMENT_MAX,
): string[] {
  const text = normaliseTranscript(transcript)
  if (!text) return []
  const tiers = [PARAGRAPH_BREAK, SENTENCE_BREAK, WHITESPACE].map((re) => breakEnds(text, re))
  const segments: string[] = []
  let start = 0
  while (text.length - start > max) {
    const hi = start + max
    let cut: number | null = null
    for (const ends of tiers) {
      cut = lastIn(ends, start + min - 1, hi)
      if (cut !== null) break
    }
    if (cut === null) {
      for (const ends of tiers) {
        cut = lastIn(ends, start, hi)
        if (cut !== null) break
      }
    }
    const end = cut ?? hi
    const segment = text.slice(start, end).trim()
    if (segment) segments.push(segment)
    start = end
  }
  const tail = text.slice(start).trim()
  if (tail) segments.push(tail)
  return segments
}

export function verbatimExcerpt(segment: string, max = VOICE_NOTE_EXCERPT_MAX): string {
  const flat = segment.replace(/\s+/g, ' ').trim()
  const sentence = flat.match(/^.*?[.!?…]+["'”’)\]]*(?=\s|$)/)?.[0] ?? flat
  if (sentence.length <= max) return sentence
  const room = sentence.slice(0, max - 1)
  const space = room.lastIndexOf(' ')
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`
}

export function voiceNoteTitle(part: number, of: number, excerpt: string): string {
  const head = of > 1 ? `Voice note ${part}/${of}` : 'Voice note'
  const words = excerpt.length > 80 ? `${excerpt.slice(0, 79).trimEnd()}…` : excerpt
  return words ? `${head}: ${words}` : head
}

export function readVoiceNote(sourceMetadata: unknown): VoiceNoteRef | null {
  if (!sourceMetadata || typeof sourceMetadata !== 'object') return null
  const v = (sourceMetadata as Record<string, unknown>).voiceNote
  if (!v || typeof v !== 'object') return null
  const { noteId, part, of } = v as Record<string, unknown>
  if (typeof noteId !== 'string' || !noteId) return null
  if (typeof part !== 'number' || typeof of !== 'number') return null
  return { noteId, part, of }
}

export interface VoiceNoteGroupable {
  kind: string
  id: string
  title: string
  summary?: string | null
  createdAt: Date
  voiceNote?: VoiceNoteRef | null
}

export interface VoiceNoteGroup<T extends VoiceNoteGroupable> {
  kind: 'voice_note'
  noteId: string
  parts: number
  pendingIds: string[]
  segments: T[]
  title: string
  summary: string | null
  createdAt: Date
}

export function groupVoiceNoteProposals<T extends VoiceNoteGroupable>(
  items: readonly T[],
): Array<T | VoiceNoteGroup<T>> {
  const groups = new Map<string, VoiceNoteGroup<T>>()
  const out: Array<T | VoiceNoteGroup<T>> = []
  for (const item of items) {
    const ref = item.kind === 'proposal' ? item.voiceNote : null
    if (!ref) {
      out.push(item)
      continue
    }
    const group = groups.get(ref.noteId)
    if (group) {
      group.segments.push(item)
      continue
    }
    const fresh: VoiceNoteGroup<T> = {
      kind: 'voice_note',
      noteId: ref.noteId,
      parts: ref.of,
      pendingIds: [],
      segments: [item],
      title: '',
      summary: null,
      createdAt: item.createdAt,
    }
    groups.set(ref.noteId, fresh)
    out.push(fresh)
  }
  for (const group of groups.values()) {
    group.segments.sort((a, b) => (a.voiceNote?.part ?? 0) - (b.voiceNote?.part ?? 0))
    group.pendingIds = group.segments.map((s) => s.id)
    const first = group.segments[0]
    group.title = group.parts > 1 ? `Voice note · ${group.parts} parts` : 'Voice note'
    group.summary = first.summary ?? null
    group.createdAt = group.segments.reduce((d, s) => (s.createdAt < d ? s.createdAt : d), first.createdAt)
  }
  return out
}
