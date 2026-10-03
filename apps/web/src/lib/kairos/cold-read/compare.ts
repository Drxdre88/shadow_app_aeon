import type { ColdStance, ColdVerdict } from './prompt'
import type { Stance, StanceValue } from './stance'

// Warm vs cold comparison, the "Second look" text and the Health summary.
// Measurement only: nothing here feeds a prompt, a belief or the
// constitution. Pure, no I/O.

export const STANCE_SCORE: Record<StanceValue, number> = {
  endorse: 2,
  lean_endorse: 1,
  mixed: 0,
  lean_against: -1,
  against: -2,
}

export const COLD_CONFIDENCE_MIN = 0.6
export const SECOND_LOOK_MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface StanceComparison {
  gap: number | null
  disagree: boolean
}

export function compareStances(warm: StanceValue, cold: ColdStance, confidence: number): StanceComparison {
  if (cold === 'insufficient') return { gap: null, disagree: false }
  const w = STANCE_SCORE[warm]
  const c = STANCE_SCORE[cold]
  const gap = Math.abs(w - c)
  const material = gap >= 2 || (w !== 0 && c !== 0 && Math.sign(w) !== Math.sign(c))
  return { gap, disagree: material && confidence >= COLD_CONFIDENCE_MIN }
}

const WARM_PHRASE: Record<StanceValue, string> = {
  endorse: 'for it',
  lean_endorse: 'mildly for it',
  mixed: 'on the fence',
  lean_against: 'mildly against it',
  against: 'against it',
}

const COLD_PHRASE: Record<StanceValue, string> = {
  endorse: 'back it',
  lean_endorse: 'lean towards it',
  mixed: 'call it mixed',
  lean_against: 'lean against it',
  against: 'advise against it',
}

export const SECOND_LOOK_TITLE = 'Second look'

export function buildSecondLookMessage(warm: Stance, cold: ColdVerdict & { stance: StanceValue }): string {
  const parts = [
    `Second look: with your history in mind I was ${WARM_PHRASE[warm.value]}; looking at it cold, as if someone else proposed it, I'd ${COLD_PHRASE[cold.stance]}: ${cold.verdict}`,
  ]
  if (cold.reasons.length > 0) parts.push(cold.reasons.map((r) => `- ${r}`).join('\n'))
  if (warm.gist) parts.push(`Re: ${warm.gist}`)
  return parts.join('\n\n')
}

export type ColdReadDelivery = 'sent' | 'blocked' | 'failed' | 'already' | 'audit' | 'agree' | 'insufficient' | 'stale' | 'unparsed'

export interface ColdReadSummary {
  windowDays: number
  total: number
  disagreed: number
  said: number
  insufficient: number
  unparsed: number
  latestAt: Date | null
}

export interface ColdReadSummaryRow {
  createdAt: Date
  coldRead: unknown
}

function field(o: unknown, key: string): unknown {
  return o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined
}

// Health: cold reads in the last `windowDays` — how many ran, how many
// disagreed, how many were said, how many could not judge or parse.
export function summariseColdReads(rows: readonly ColdReadSummaryRow[], now: Date, windowDays = 7): ColdReadSummary {
  const since = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const summary: ColdReadSummary = { windowDays, total: 0, disagreed: 0, said: 0, insufficient: 0, unparsed: 0, latestAt: null }
  for (const row of rows) {
    if (row.createdAt.getTime() < since || row.createdAt.getTime() > now.getTime()) continue
    summary.total++
    if (field(row.coldRead, 'disagree') === true) summary.disagreed++
    if (field(row.coldRead, 'delivered') === 'sent') summary.said++
    if (field(row.coldRead, 'status') === 'unparsed') summary.unparsed++
    else if (field(field(row.coldRead, 'cold'), 'stance') === 'insufficient') summary.insufficient++
    if (!summary.latestAt || row.createdAt > summary.latestAt) summary.latestAt = row.createdAt
  }
  return summary
}

export function renderColdReadsLine(s: ColdReadSummary): string {
  return `Cold reads ${s.windowDays}d: ${s.total} · ${s.disagreed} disagreed · ${s.said} said.`
}
