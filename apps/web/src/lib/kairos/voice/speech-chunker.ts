import { toSpeechText } from './speech-text'

// Turns raw model deltas into whole spoken sentences. A text-to-speech voice
// needs complete sentences, and the raw stream carries things that must never
// be spoken (`[[memory-id]]` citations, the hidden `<stance>` tag, markdown),
// which can straddle delta boundaries. Text is held until a sentence ends
// outside any open citation, stance tag or code fence, then cleaned.

const SENTENCE_BOUNDARY = /(?<!\d)[.!?…]+["'”’)\]]*\s+/g

function hasOpenSpan(text: string): boolean {
  const opens = (text.match(/\[\[/g) ?? []).length
  const closes = (text.match(/\]\]/g) ?? []).length
  if (opens > closes) return true
  const stanceOpens = (text.match(/<\s*stance\s*>/gi) ?? []).length
  const stanceCloses = (text.match(/<\s*\/\s*stance\s*>/gi) ?? []).length
  if (stanceOpens > stanceCloses) return true
  return (text.match(/```/g) ?? []).length % 2 === 1
}

export class SpeechChunker {
  private buffer = ''

  constructor(private readonly emit: (sentence: string) => void) {}

  push(delta: string): void {
    if (!delta) return
    this.buffer += delta
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

  flush(): void {
    const rest = this.buffer
    this.buffer = ''
    this.say(rest)
  }

  private say(raw: string): void {
    const spoken = toSpeechText(raw)
    if (spoken) this.emit(spoken)
  }
}
