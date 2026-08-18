import { create } from 'zustand'

export type SizingUnit = 'days' | 'points'

export interface SizingLabel {
  key: string
  value: number
}

export interface BoardSizing {
  enabled: boolean
  unit: SizingUnit
  labels: SizingLabel[]
}

export const MAX_SIZING_LABELS = 6

// task.size is a real column validated as 0.5-20 in half steps, so every
// sizing value has to land inside that range to be persistable.
export const MIN_SIZING_VALUE = 0.5
export const MAX_SIZING_VALUE = 20

export const DEFAULT_SIZING: BoardSizing = {
  enabled: true,
  unit: 'days',
  labels: [
    { key: 'S', value: 1 },
    { key: 'M', value: 5 },
    { key: 'L', value: 10 },
    { key: 'XL', value: 20 },
  ],
}

export function clampSizingValue(value: number): number {
  const stepped = Math.round(value * 2) / 2
  return Math.min(MAX_SIZING_VALUE, Math.max(MIN_SIZING_VALUE, stepped))
}

export function parseSizing(settings: Record<string, unknown> | null | undefined): BoardSizing {
  const raw = settings?.sizing as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return DEFAULT_SIZING

  const rawLabels = Array.isArray(raw.labels) ? raw.labels : null
  const labels = rawLabels
    ? rawLabels
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({ key: String(l.key ?? '').trim(), value: Number(l.value) }))
        .filter((l) => l.key.length > 0 && Number.isFinite(l.value))
        .map((l) => ({ key: l.key, value: clampSizingValue(l.value) }))
        .slice(0, MAX_SIZING_LABELS)
    : DEFAULT_SIZING.labels

  return {
    // Sizing is on unless a board explicitly turned it off.
    enabled: raw.enabled !== false,
    unit: raw.unit === 'points' ? 'points' : 'days',
    labels: labels.length > 0 ? labels : DEFAULT_SIZING.labels,
  }
}

export function sizingLabelFor(sizing: BoardSizing, size: number | null | undefined): string | null {
  if (size === null || size === undefined) return null
  return sizing.labels.find((l) => l.value === size)?.key ?? null
}

export function sizingUnitLabel(unit: SizingUnit, value: number): string {
  if (unit === 'points') return `${value} ${value === 1 ? 'point' : 'points'}`
  return `${value} ${value === 1 ? 'day' : 'days'}`
}

export function sizingTooltip(sizing: BoardSizing, label: SizingLabel): string {
  return `${label.key} = ${sizingUnitLabel(sizing.unit, label.value)}`
}

interface BoardSizingState {
  sizing: BoardSizing
  setSizing: (sizing: BoardSizing) => void
}

// Board-scoped config lives outside boardStore so cards and the edit modal can
// read it without threading a prop through every column/list memo boundary.
export const useBoardSizingStore = create<BoardSizingState>()((set) => ({
  sizing: DEFAULT_SIZING,
  setSizing: (sizing) => set({ sizing }),
}))

export const useBoardSizing = () => useBoardSizingStore((s) => s.sizing)
