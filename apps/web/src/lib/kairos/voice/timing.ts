// Where one voice turn's time goes: the `timing` object on the `done` event
// and the `[kairos-voice] turn timing` log. The clock starts when the route
// receives the request. Marks are milliseconds since then; the first mark of a
// name wins, so a repeated step keeps its earliest time. Spans are durations
// of steps that run side by side (the grounding reads). Counts tally repeats
// (tool rounds, model calls).

export type VoiceTurnMark =
  | 'accepted'
  | 'thread'
  | 'retrieved'
  | 'grounded'
  | 'model_call'
  | 'first_text'
  | 'answer_end'
  | 'answered'
  | 'saved'

export interface VoiceStreamTiming {
  firstDeltaMs: number | null
  totalMs: number
  deltas: number
}

export type VoiceTimingPayload = Record<string, number | boolean | null | Record<string, number>>

export class VoiceTurnClock {
  private readonly startedAt: number
  private readonly marks = new Map<string, number>()
  private readonly spans = new Map<string, number>()
  private readonly counts = new Map<string, number>()
  private readonly facts = new Map<string, number | boolean>()

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now()
  }

  elapsed(): number {
    return this.now() - this.startedAt
  }

  mark(name: VoiceTurnMark): void {
    if (!this.marks.has(name)) this.marks.set(name, this.elapsed())
  }

  span(name: string, ms: number): void {
    this.spans.set(name, Math.max(0, Math.round(ms)))
  }

  count(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by)
  }

  note(name: string, value: number | boolean): void {
    this.facts.set(name, value)
  }

  snapshot(): Record<string, number | boolean> {
    const out: Record<string, number | boolean> = {}
    for (const [name, ms] of this.marks) out[`${camel(name)}Ms`] = ms
    for (const [name, n] of this.counts) out[name] = n
    for (const [name, v] of this.facts) out[name] = v
    return out
  }

  // Stage durations for the `done` event. Stream times are rebased onto the
  // request clock, so every number reads from the moment the route got it.
  payload(stream: VoiceStreamTiming, streamStartedMs: number): VoiceTimingPayload {
    const at = (name: VoiceTurnMark) => this.marks.get(name) ?? null
    const between = (from: VoiceTurnMark, to: VoiceTurnMark) => {
      const a = at(from)
      const b = at(to)
      return a === null || b === null ? null : b - a
    }
    const sections: Record<string, number> = {}
    for (const [name, ms] of this.spans) {
      if (name.startsWith('section:')) sections[name.slice('section:'.length)] = ms
    }
    return {
      routeMs: at('accepted'),
      threadMs: this.spans.get('thread') ?? null,
      retrievalMs: this.spans.get('retrieval') ?? null,
      embeddingMs: this.spans.get('embedding') ?? null,
      rerankMs: this.spans.get('rerank') ?? null,
      sections,
      groundedMs: at('grounded'),
      promptChars: (this.facts.get('promptChars') as number | undefined) ?? null,
      modelCallMs: at('model_call'),
      modelFirstTokenMs: between('model_call', 'first_text'),
      modelTotalMs: between('model_call', 'answer_end') ?? between('model_call', 'answered'),
      saveMs: between('answered', 'saved'),
      firstDeltaMs: stream.firstDeltaMs === null ? null : streamStartedMs + stream.firstDeltaMs,
      totalMs: streamStartedMs + stream.totalMs,
      deltas: stream.deltas,
      tools: this.facts.get('tools') ?? false,
      toolRounds: this.counts.get('toolRounds') ?? 0,
      plainCalls: this.counts.get('plainCalls') ?? 0,
    }
  }
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
