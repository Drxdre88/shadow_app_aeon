import { toSpeechText } from './speech-text'

// Turns raw model deltas into speakable pieces: whole sentences, and, once a
// sentence has run on for a few words, the clause before a comma, semicolon
// or dash, so the first audio can start before the first full stop. A
// text-to-speech voice needs complete phrases, and the raw stream carries
// things that must never be spoken (`[[memory-id]]` citations, the hidden
// `<stance>` tag, markdown), which can straddle delta boundaries. Text is held
// until a boundary falls outside any open citation, stance tag or code fence,
// then cleaned. A clause piece keeps its comma, semicolon or dash so the
// listener (and the desk app) can tell it is not a full sentence.

const SENTENCE_BOUNDARY = /(?<!\d)[.!?…]+["'”’)\]]*\s+/g
// `1,000` has no space after its comma, so numbers never split.
const CLAUSE_BOUNDARY = /([,;])["'”’)\]]*\s+|\s+[-–—]\s+|(—|–)(?=\S)/g

// Words a clause needs before it is spoken alone; shorter ones wait.
export const CLAUSE_MIN_WORDS = 6

function hasOpenSpan(text: string): boolean {
  const opens = (text.match(/\[\[/g) ?? []).length
  const closes = (text.match(/\]\]/g) ?? []).length
  if (opens > closes) return true
  const stanceOpens = (text.match(/<\s*stance\s*>/gi) ?? []).length
  const stanceCloses = (text.match(/<\s*\/\s*stance\s*>/gi) ?? []).length
  if (stanceOpens > stanceCloses) return true
  return (text.match(/```/g) ?? []).length % 2 === 1
}

function wordCount(spoken: string): number {
  return (spoken.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
}

export interface SpeechChunkerOptions {
  // Minimum words for a clause piece; 0 turns clause pieces off (sentences only).
  clauseWords?: number
}

export class SpeechChunker {
  private buffer = ''
  private readonly clauseWords: number

  constructor(private readonly emit: (piece: string) => void, opts: SpeechChunkerOptions = {}) {
    this.clauseWords = opts.clauseWords ?? CLAUSE_MIN_WORDS
  }

  push(delta: string): void {
    if (!delta) return
    this.buffer += delta
    this.cutSentences()
    if (this.clauseWords > 0) this.cutClauses()
  }

  flush(): void {
    const rest = this.buffer
    this.buffer = ''
    this.say(rest)
  }

  private cutSentences(): void {
    let cut = -1
    for (const match of this.buffer.matchAll(SENTENCE_BOUNDARY)) {
      const end = (match.index ?? 0) + match[0].length
      if (!hasOpenSpan(this.buffer.slice(0, end))) cut = end
    }
    if (cut <= 0) return
    const ready = this.buffer.slice(0, cut)
    this.buffer = this.buffer.slice(cut)
    this.say(ready)
  }

  // Earliest boundary with enough words before it; repeats on the remainder.
  private cutClauses(): void {
    for (;;) {
      let cut: { at: number; head: string; mark: string } | null = null
      for (const match of this.buffer.matchAll(CLAUSE_BOUNDARY)) {
        const start = match.index ?? 0
        const end = start + match[0].length
        const head = this.buffer.slice(0, start)
        if (hasOpenSpan(this.buffer.slice(0, end))) continue
        if (wordCount(toSpeechText(head)) < this.clauseWords) continue
        cut = { at: end, head, mark: match[1] ?? '—' }
        break
      }
      if (!cut) return
      this.buffer = this.buffer.slice(cut.at)
      const spoken = toSpeechText(cut.head).replace(/[\s,;:—–-]+$/, '')
      if (spoken) this.emit(`${spoken}${cut.mark}`)
    }
  }

  private say(raw: string): void {
    const spoken = toSpeechText(raw)
    if (spoken) this.emit(spoken)
  }
}
