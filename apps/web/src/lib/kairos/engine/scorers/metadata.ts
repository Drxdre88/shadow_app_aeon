import type { EngineMemory, OutcomeSummary, SupportSummary } from '../types'

function engineMeta(memory: EngineMemory): Record<string, unknown> {
  const engine = memory.sourceMetadata?.engine
  return engine && typeof engine === 'object' ? (engine as Record<string, unknown>) : {}
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function readSupport(memory: EngineMemory): SupportSummary | undefined {
  const raw = engineMeta(memory).support
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  return { independentSupports: count(s.independentSupports), distinctDays: count(s.distinctDays) }
}

export function readOutcome(memory: EngineMemory): OutcomeSummary | undefined {
  const raw = engineMeta(memory).outcome
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  return { positive: count(o.positive), negative: count(o.negative) }
}

export function nonNegative(value: number | undefined): number {
  return count(value)
}
