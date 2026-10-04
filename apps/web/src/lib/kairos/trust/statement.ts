import type { TrustArea } from './types'

// The owner-facing trust sentence for one area. Built only from scored inputs
// (predictions, goals, goal-linked promises); ideas and corrections never
// appear here. Never sent to a model.

export const TRUST_STATEMENT_MAX_CHARS = 220

type StatementInput = Pick<TrustArea, 'level' | 'scored' | 'calls' | 'wentAhead' | 'goals' | 'promises'>

const pct = (x: number) => Math.round(x * 100)

function calibration(overconfidence: number): string {
  const pts = pct(Math.abs(overconfidence))
  if (pts <= 5) return 'well calibrated'
  return overconfidence > 0 ? `over-confident by ${pts} pts` : `under-confident by ${pts} pts`
}

const LEVEL_CLAUSE: Record<Exclude<TrustArea['level'], 'unknown'>, string> = {
  lean: 'Lean on me here',
  second: 'Treat me as a second opinion',
  check: 'Check me here',
}

export function buildTrustStatement(area: StatementInput, windowDays: number, minN: number): string {
  if (area.level === 'unknown') return `Too little settled here to say (${area.scored.n} of ${minN}).`
  const parts: string[] = []
  const { wentAhead, calls, goals, promises } = area
  if (wentAhead.n > 0) {
    parts.push(`${wentAhead.n === 1 ? 'Once' : `${wentAhead.n} times`} you kept a plan I doubted; you were right ${wentAhead.ownerRight}.`)
  }
  if (calls) parts.push(`My calls: ${calls.right} of ${calls.n} right at ${pct(calls.meanProbability)}% stated, ${calibration(calls.overconfidence)}.`)
  if (goals.landed + goals.missed > 0) parts.push(`Goals you took from me: ${goals.landed} of ${goals.landed + goals.missed} landed.`)
  if (promises.kept + promises.missed > 0) parts.push(`Goal promises: ${promises.kept} of ${promises.kept + promises.missed} kept.`)
  const close = `${LEVEL_CLAUSE[area.level]} (${area.scored.n} settled, ${windowDays} days).`
  while (parts.length > 0 && [...parts, close].join(' ').length > TRUST_STATEMENT_MAX_CHARS) parts.pop()
  return [...parts, close].join(' ').slice(0, TRUST_STATEMENT_MAX_CHARS)
}

export const levelLabel = (level: TrustArea['level']): string =>
  level === 'unknown' ? 'too early to say' : LEVEL_CLAUSE[level].replace(/ here$/, '').toLowerCase()
