'use client'

import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useThemeStore, useSmoothUiRenders } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { GOLD, hexAlpha } from './trophy-theme'

/** Master motion switch for every trophy chart: false renders the final frame directly. */
export function useChartMotion(): boolean {
  return useSmoothUiRenders()
}

export interface ChartTooltipState {
  x: number
  y: number
  title: string
  lines: string[]
}

/**
 * Anchors a tooltip above a hovered / focused mark. Position is derived from
 * the mark's own bounding box, so pointer and keyboard share one code path.
 */
export function useChartTooltip() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)

  const showFor = useCallback((mark: Element, title: string, lines: string[]) => {
    const frame = frameRef.current
    if (!frame) return
    const f = frame.getBoundingClientRect()
    const m = mark.getBoundingClientRect()
    const x = Math.min(Math.max(m.left + m.width / 2 - f.left, 56), Math.max(f.width - 56, 56))
    setTooltip({ x, y: m.top - f.top, title, lines })
  }, [])

  const hide = useCallback(() => setTooltip(null), [])

  return { frameRef, tooltip, showFor, hide }
}

interface ChartCardProps {
  title: string
  /** Right-aligned header slot: a toggle, a legend, or a headline stat. */
  meta?: ReactNode
  /** Visually hidden data summary for screen readers. */
  summary: string
  tooltip?: ChartTooltipState | null
  frameRef?: RefObject<HTMLDivElement | null>
  className?: string
  children: ReactNode
}

export function ChartCard({ title, meta, summary, tooltip, frameRef, className, children }: ChartCardProps) {
  const colors = useThemeStore((s) => s.colors)
  return (
    <section
      aria-label={title}
      className={cn(
        'rounded-2xl p-3 backdrop-blur-xl min-w-0 flex flex-col transition-shadow duration-200',
        'hover:shadow-[0_0_0_1px_rgba(245,158,11,0.28)]',
        className
      )}
      style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center justify-between gap-2 mb-2 min-h-[22px]">
        <span className="text-[10px] uppercase tracking-widest font-semibold truncate" style={{ color: colors.textDim }}>
          {title}
        </span>
        {meta}
      </div>
      <p className="sr-only">{summary}</p>
      <div ref={frameRef} className="relative flex-1 min-h-0">
        {children}
        {tooltip && <ChartTooltip {...tooltip} />}
      </div>
    </section>
  )
}

function ChartTooltip({ x, y, title, lines }: ChartTooltipState) {
  const colors = useThemeStore((s) => s.colors)
  return (
    <div
      role="tooltip"
      className="absolute z-10 pointer-events-none px-2.5 py-1.5 rounded-lg text-[11px] leading-snug shadow-lg whitespace-nowrap"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 8px))',
        background: colors.background,
        border: `1px solid ${hexAlpha(GOLD.base, 0.35)}`,
        color: colors.text,
      }}
    >
      <div className="font-semibold">{title}</div>
      {lines.map((line) => (
        <div key={line} style={{ color: colors.textMuted }}>
          {line}
        </div>
      ))}
    </div>
  )
}

/** Intentional empty state, inset in the plot area. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  const colors = useThemeStore((s) => s.colors)
  return (
    <div
      className="flex items-center justify-center text-center text-xs px-4 py-8 rounded-xl"
      style={{ color: colors.textDim, border: `1px dashed ${hexAlpha(GOLD.base, 0.25)}` }}
    >
      {children}
    </div>
  )
}

interface LegendItem {
  label: string
  kind: 'bar' | 'line'
  color: string
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  const colors = useThemeStore((s) => s.colors)
  return (
    <div className="flex items-center gap-3 text-[10px]" style={{ color: colors.textDim }}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.kind === 'bar' ? (
            <span className="w-2 h-2 rounded-sm" style={{ background: item.color }} />
          ) : (
            <span className="w-3 h-0.5 rounded-full" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}

/** Shared segmented-toggle button styling, keyboard-visible. */
export const SEGMENT_BUTTON_CLASS =
  'rounded-md text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60'
