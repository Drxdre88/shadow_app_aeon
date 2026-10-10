// Where one voice turn's time goes, for the `[kairos-voice] turn timing` log.
// Marks are milliseconds since the turn started; the first mark of a name
// wins, so a repeated step keeps its earliest time. Counts tally repeats
// (tool rounds, model calls).

export type VoiceTurnMark =
  | 'retrieved'
  | 'grounded'
  | 'model_call'
  | 'first_text'
  | 'answered'
  | 'saved'

export class VoiceTurnClock {
  private readonly startedAt: number
  private readonly marks = new Map<string, number>()
  private readonly counts = new Map<string, number>()
  private readonly facts = new Map<string, number | boolean>()

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now()
  }

  mark(name: VoiceTurnMark): void {
    if (!this.marks.has(name)) this.marks.set(name, this.now() - this.startedAt)
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
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
