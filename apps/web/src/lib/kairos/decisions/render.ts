import type { DecisionCalibration, DecisionTypeCalibration, KairosDecisionView, KairosDecisionsList } from './types'

// Plain-words rendering of the decision journal (UI, MCP + REST markdown).

const OVERCONFIDENCE_NOTE = 0.1

export function percent(p: number): string {
  return `${Math.round(p * 100)}%`
}

function confidenceNote(overconfidence: number): string {
  if (overconfidence >= OVERCONFIDENCE_NOTE) return 'you tend to be over-sure'
  if (overconfidence <= -OVERCONFIDENCE_NOTE) return 'you tend to be under-sure'
  return 'about as sure as you should be'
}

export function calibrationSentence(row: DecisionTypeCalibration): string {
  return `${row.label}: ${row.right} of ${row.n} right when you were ${percent(row.meanProbability)} sure — ${confidenceNote(row.overconfidence)}`
}

export function calibrationLines(calibration: DecisionCalibration): string[] {
  const lines = calibration.byType.map(calibrationSentence)
  for (const b of calibration.building) {
    lines.push(`${b.label}: ${b.n} settled so far — ${calibration.minPerType - b.n} more before a read`)
  }
  return lines
}

export function decisionStatusText(d: KairosDecisionView): string {
  if (d.needsConfirm) return 'relayed, confirm?'
  if (d.status !== 'open') return d.status
  return d.due ? `due ${d.checkBy}` : `check by ${d.checkBy}`
}

export function renderDecisionsMarkdown(list: KairosDecisionsList): string {
  const out: string[] = ['## Decision journal']
  if (list.decisions.length === 0) out.push('', '_No decisions logged._')
  else {
    out.push('')
    for (const d of list.decisions) {
      out.push(`- **${d.number}** (${d.typeLabel}, ${percent(d.probability)} sure, ${decisionStatusText(d)}) ${d.decision} — expect: ${d.expectation}`)
    }
  }
  out.push('', '### Calibration')
  const lines = calibrationLines(list.calibration)
  if (lines.length === 0) out.push(`_Nothing settled yet — a read shows once a type has ${list.calibration.minPerType} settled decisions._`)
  else for (const line of lines) out.push(`- ${line}`)
  return out.join('\n')
}
