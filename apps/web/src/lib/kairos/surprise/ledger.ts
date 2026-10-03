import { hash8 } from '@/lib/kairos/stage/normalise'
import {
  SURPRISE_MAX_BYTES,
  SURPRISE_MAX_EVENTS,
  SURPRISE_MAX_OPENED,
  SURPRISE_MAX_REFS,
  SURPRISE_MAX_SEEN,
  SURPRISE_RETENTION_MS,
  surpriseEventInputSchema,
  type KairosSurpriseLedger,
  type SurpriseEvent,
  type SurpriseEventInput,
} from '@/lib/data/validators/kairos-surprise'

// The surprise ledger policy (pure) + recordSurprise, the one producer entry
// point. The data module (lib/data/kairos-surprise) is imported lazily so the
// pure helpers never pull in the database client.

export function emptySurpriseLedger(): KairosSurpriseLedger {
  return { v: 1, events: [], seen: [], lp: null, replay: null }
}

export function surpriseEventId(key: string, salt = 0): string {
  return `s_${hash8(salt === 0 ? key : `${key}|${salt}`)}`
}

const size = (l: KairosSurpriseLedger) => JSON.stringify(l).length

// Caps: events within 7 days of `now` and ≤64 (oldest dropped first), seen
// ≤128 (oldest keys dropped), whole blob ≤16KB (oldest events, then oldest
// seen keys, dropped until it fits). Events are stored oldest → newest.
export function pruneSurpriseLedger(ledger: KairosSurpriseLedger, now: Date): KairosSurpriseLedger {
  const cutoff = now.getTime() - SURPRISE_RETENTION_MS
  const events = ledger.events
    .filter((e) => {
      const t = Date.parse(e.at)
      return Number.isFinite(t) && t >= cutoff
    })
    .slice(-SURPRISE_MAX_EVENTS)
  let out: KairosSurpriseLedger = { ...ledger, events, seen: ledger.seen.slice(-SURPRISE_MAX_SEEN) }
  while (size(out) > SURPRISE_MAX_BYTES && out.events.length > 0) out = { ...out, events: out.events.slice(1) }
  while (size(out) > SURPRISE_MAX_BYTES && out.seen.length > 0) out = { ...out, seen: out.seen.slice(1) }
  return out
}

const uniq = (xs: readonly string[] | undefined, cap: number) => (xs ? [...new Set(xs)].slice(0, cap) : undefined)

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

// Normalises a producer's input into a stored event (throws on bad input).
// s is clamped to [0,1]; refs/opened are de-duplicated and capped.
export function buildSurpriseEvent(input: SurpriseEventInput, now: Date, taken: ReadonlySet<string> = new Set()): SurpriseEvent {
  const parsed = surpriseEventInputSchema.parse({
    ...input,
    s: clamp01(input.s),
    ...(input.refs ? {
      refs: {
        ...input.refs,
        ...(input.refs.beliefIds ? { beliefIds: uniq(input.refs.beliefIds, SURPRISE_MAX_REFS) } : {}),
        ...(input.refs.memoryIds ? { memoryIds: uniq(input.refs.memoryIds, SURPRISE_MAX_REFS) } : {}),
      },
    } : {}),
    ...(input.opened ? { opened: uniq(input.opened, SURPRISE_MAX_OPENED) } : {}),
  })
  let salt = 0
  let id = surpriseEventId(parsed.key)
  while (taken.has(id)) id = surpriseEventId(parsed.key, ++salt)
  const refs = parsed.refs ?? {}
  const event: SurpriseEvent = {
    id,
    key: parsed.key,
    at: parsed.at ?? now.toISOString(),
    kind: parsed.kind,
    s: Math.round(parsed.s * 1000) / 1000,
    dominionId: parsed.dominionId ?? null,
    refs: {
      ...(refs.predictionId ? { predictionId: refs.predictionId } : {}),
      ...(refs.promiseId ? { promiseId: refs.promiseId } : {}),
      beliefIds: refs.beliefIds ?? [],
      memoryIds: refs.memoryIds ?? [],
    },
    opened: parsed.opened ?? [],
  }
  if (parsed.credited) event.credited = parsed.credited
  return event
}

export interface ApplySurpriseResult {
  event: SurpriseEvent | null
  created: boolean
}

// Pure mutation for mutateKairosSurprise. Idempotent by `key`: a key already
// in `seen` writes nothing and returns the stored event (or null once it has
// aged out of `events`).
export function applySurpriseEvent(
  ledger: KairosSurpriseLedger,
  input: SurpriseEventInput,
  now: Date,
): { state: KairosSurpriseLedger | null; result: ApplySurpriseResult } {
  if (ledger.seen.includes(input.key)) {
    return { state: null, result: { event: ledger.events.find((e) => e.key === input.key) ?? null, created: false } }
  }
  const event = buildSurpriseEvent(input, now, new Set(ledger.events.map((e) => e.id)))
  const next = pruneSurpriseLedger({ ...ledger, events: [...ledger.events, event], seen: [...ledger.seen, event.key] }, now)
  return { state: next, result: { event: next.events.find((e) => e.id === event.id) ?? null, created: true } }
}

export function surpriseKeySeen(ledger: KairosSurpriseLedger, key: string): boolean {
  return ledger.seen.includes(key)
}

// Records one surprise event. Idempotent by key; never throws. Returns the
// stored event (the existing one on a repeat), or null on failure / when the
// event is already outside retention.
export async function recordSurprise(
  userId: string,
  event: SurpriseEventInput,
  opts: { now?: Date } = {},
): Promise<SurpriseEvent | null> {
  try {
    const now = opts.now ?? new Date()
    const { mutateKairosSurprise } = await import('@/lib/data/kairos-surprise')
    const { event: stored } = await mutateKairosSurprise(userId, (l) => applySurpriseEvent(l, event, now), now)
    return stored
  } catch (err) {
    console.error('[kairos:surprise] recordSurprise failed:', err)
    return null
  }
}
