import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import type { TodayEntryView } from '@/lib/data/kairos-today'
import { londonDayStart } from '@/lib/kairos/thinking/deadlines'
import { hash8, sanitiseStageText } from './normalise'
import { londonDateOf } from './select'
import type { AmbientCandidate } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Ambient stage sources (spec_stage §3): server facts nobody "thinks" but the
// stage should hold — an overdue promise, a prediction settled wrong in the
// last 24h, and the owner's own said/decided lines from today. Recomputed on
// cycle rollover; keys are stable per London day so each fact posts once a
// day (ambientSeen). Owner lines are speaker 'owner' and never relayed.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const MAX_PER_SOURCE = 2
const OWNER_LINE_CHARS = 160

export interface AmbientInputs {
  promises: readonly KairosPromise[]
  predictions: readonly KairosPrediction[]
  today: readonly TodayEntryView[]
  now: Date
}

export function buildAmbientCandidates(input: AmbientInputs): AmbientCandidate[] {
  const day = londonDateOf(input.now)
  const out: AmbientCandidate[] = []

  const overdue = input.promises
    .filter((p) => p.status === 'open' && p.dueDate < day)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, MAX_PER_SOURCE)
  for (const p of overdue) {
    const text = sanitiseStageText(`A promise is overdue (due ${p.dueDate}): ${p.outcome}`)
    if (text) out.push({ key: `promise:${p.id}:${day}`, kind: 'promise', source: 'promise', tier: 'deep', text, importance: 0.8, surprise: 0.3, goalRelevance: 0.6, need: 0.8 })
  }

  const from = input.now.getTime() - DAY_MS
  const wrong = input.predictions
    .filter((p) => p.status === 'wrong' && p.settledAt && new Date(p.settledAt).getTime() >= from)
    .sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''))
    .slice(0, MAX_PER_SOURCE)
  for (const p of wrong) {
    const text = sanitiseStageText(`My prediction was wrong: ${p.claim}`)
    if (text) out.push({ key: `prediction:${p.id}:${day}`, kind: 'prediction', source: 'prediction', tier: 'deep', text, importance: 0.6, surprise: 0.9, goalRelevance: 0.4, need: 0.4 })
  }

  const dayStart = londonDayStart(input.now).getTime()
  const owner = input.today
    .filter((e) => e.speaker === 'owner' && !e.relayed && (e.type === 'said' || e.type === 'decided'))
    .filter((e) => new Date(e.at).getTime() >= dayStart)
    .slice(-MAX_PER_SOURCE)
  for (const e of owner) {
    const said = sanitiseStageText(e.text, OWNER_LINE_CHARS)
    if (!said) continue
    const text = sanitiseStageText(e.type === 'decided' ? `The owner decided: ${said}` : `The owner said: ${said}`)
    if (!text) continue
    out.push({
      key: `owner:${day}:${hash8(`${e.type}|${e.text}`)}`,
      kind: 'owner',
      source: 'owner',
      tier: 'owner',
      text,
      importance: e.type === 'decided' ? 0.8 : 0.6,
      surprise: 0.3,
      goalRelevance: 0.5,
      need: 0.5,
    })
  }
  return out
}

// I/O half. Reads run BEFORE the stage transaction (Neon pool 8s). Each
// source fails independently: a bad blob silences only its own facts.
export async function gatherAmbient(userId: string, now: Date): Promise<AmbientCandidate[]> {
  const [{ readKairosPromises }, { readKairosPredictions }, { listTodayEntries, toKairosTodayView }] = await Promise.all([
    import('@/lib/data/kairos-promises'),
    import('@/lib/data/kairos-predictions'),
    import('@/lib/data/kairos-today'),
  ])
  const quiet = <T>(p: Promise<T>, fallback: T, label: string) =>
    p.catch((err) => {
      console.error(`[kairos:stage] ambient ${label} read failed:`, err)
      return fallback
    })
  const [promises, predictions, today] = await Promise.all([
    quiet(readKairosPromises(userId).then((s) => s.open), [], 'promises'),
    quiet(readKairosPredictions(userId).then((s) => s.closed), [], 'predictions'),
    quiet(listTodayEntries(userId, { hours: 24, limit: 100, now }).then((rows) => rows.map(toKairosTodayView)), [], 'today'),
  ])
  return buildAmbientCandidates({ promises, predictions, today, now })
}
