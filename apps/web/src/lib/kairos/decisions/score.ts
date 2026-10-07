import type { KairosDecision } from '@/lib/data/validators/kairos-decisions'
import { metricsFor } from '@/lib/kairos/predictions/score'
import type { DecisionCalibration, DecisionTypeBuilding, DecisionTypeCalibration } from './types'
import { decisionTypeLabel } from './types'

// The owner's calibration per decision type. Only right/wrong count; void
// never does, and a relayed entry counts only once the owner confirmed it.
// Shown per type once it has DECISION_CALIBRATION_MIN_N settled decisions.

export const DECISION_CALIBRATION_MIN_N = 3

export function countsTowardCalibration(d: KairosDecision): boolean {
  if (d.status !== 'right' && d.status !== 'wrong') return false
  return d.origin.kind === 'owner' || Boolean(d.confirmedAt)
}

export function calibrateDecisions(closed: readonly KairosDecision[]): DecisionCalibration {
  const scored = closed.filter(countsTowardCalibration)
  const groups = new Map<string, KairosDecision[]>()
  for (const d of scored) groups.set(d.decisionType, [...(groups.get(d.decisionType) ?? []), d])
  const byType: DecisionTypeCalibration[] = []
  const building: DecisionTypeBuilding[] = []
  for (const [decisionType, list] of groups) {
    const label = decisionTypeLabel(decisionType)
    const metrics = metricsFor(list)
    if (metrics && metrics.n >= DECISION_CALIBRATION_MIN_N) byType.push({ decisionType, label, ...metrics })
    else building.push({ decisionType, label, n: list.length })
  }
  byType.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  building.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  return { minPerType: DECISION_CALIBRATION_MIN_N, settled: scored.length, byType, building }
}
