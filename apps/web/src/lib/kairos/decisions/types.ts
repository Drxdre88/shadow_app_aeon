import type { ScoreMetrics } from '@/lib/kairos/predictions/score'
import type { DecisionStatus } from '@/lib/data/validators/kairos-decisions'

// Client-safe shapes for the decision journal (no server imports).

export interface DecisionTypePreset { key: string; short: string; label: string }

export const DECISION_TYPE_PRESETS: readonly DecisionTypePreset[] = [
  { key: 'priority', short: 'Priorities', label: 'Priority calls' },
  { key: 'hire', short: 'Hiring', label: 'Hiring calls' },
  { key: 'project', short: 'Which project', label: 'Project bets' },
  { key: 'people', short: 'People', label: 'People calls' },
  { key: 'spend', short: 'Spending', label: 'Spending calls' },
]

export function normalizeDecisionType(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ').toLowerCase()
  const preset = DECISION_TYPE_PRESETS.find((p) => p.key === s || p.short.toLowerCase() === s || p.label.toLowerCase() === s)
  return preset ? preset.key : s
}

export function decisionTypeLabel(decisionType: string): string {
  const preset = DECISION_TYPE_PRESETS.find((p) => p.key === decisionType)
  if (preset) return preset.label
  const text = decisionType.trim()
  if (!text) return 'Other calls'
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} calls`
}

export interface KairosDecisionView {
  id: string
  number: string
  seq: number
  decision: string
  expectation: string
  probability: number
  decisionType: string
  typeLabel: string
  checkBy: string
  due: boolean
  status: DecisionStatus
  relayed: boolean
  needsConfirm: boolean
  createdAt: string
  settledAt: string | null
}

export interface DecisionTypeCalibration extends ScoreMetrics {
  decisionType: string
  label: string
}

export interface DecisionTypeBuilding {
  decisionType: string
  label: string
  n: number
}

export interface DecisionCalibration {
  minPerType: number
  settled: number
  byType: DecisionTypeCalibration[]
  building: DecisionTypeBuilding[]
}

export interface KairosDecisionsList {
  decisions: KairosDecisionView[]
  calibration: DecisionCalibration
}
