'use client'

import type { DepLineStyle, DepViewMode } from '@/stores/themeStore'

interface GlowTreeEdgeProps {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  index: number
  isResolved: boolean
  edgeMode: DepViewMode
  sourceColor?: string
  targetColor?: string
  lineWidth?: number
  lineGlow?: number
  lineStyle?: DepLineStyle
}

export function GlowTreeEdge({
  sourceX, sourceY, targetX, targetY, index, isResolved,
  edgeMode, sourceColor, targetColor, lineWidth = 1.5, lineGlow = 60, lineStyle = 'solid',
}: GlowTreeEdgeProps) {
  const midX = (sourceX + targetX) / 2
  const d = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`

  if (edgeMode === 'arrows') {
    const sHex = sourceColor || (isResolved ? '#34d399' : '#f87171')
    const tHex = targetColor || sHex
    const sameColor = sHex === tHex
    const gradId = `arrow-grad-${index}`
    const markerId = `arrow-marker-${index}`
    const dashArray = lineStyle === 'dashed' ? '8 4' : lineStyle === 'dotted' ? '2 4' : undefined
    const strokeColor = sameColor ? sHex : `url(#${gradId})`
    const glowMult = lineGlow / 60
    const haloWidth = Math.max(lineWidth * 3, 4) * glowMult

    return (
      <g>
        <defs>
          {!sameColor && (
            <linearGradient id={gradId} gradientUnits="userSpaceOnUse"
              x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}
            >
              <stop offset="0%" stopColor={sHex} />
              <stop offset="100%" stopColor={tHex} />
            </linearGradient>
          )}
          <marker
            id={markerId}
            viewBox="0 0 10 8"
            refX="9"
            refY="4"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 4 L 0 8 z" fill={tHex} />
          </marker>
        </defs>

        {lineGlow > 0 && (
          <path
            d={d}
            fill="none"
            stroke={sHex}
            strokeWidth={haloWidth}
            strokeLinecap="round"
            opacity={0.15}
          />
        )}

        <path
          d={d}
          fill="none"
          stroke={strokeColor}
          strokeWidth={lineWidth}
          strokeDasharray={dashArray}
          strokeLinecap="round"
          markerEnd={`url(#${markerId})`}
        />
      </g>
    )
  }

  const edgeColor = isResolved ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.6)'
  const edgeColorBright = isResolved ? 'rgba(52, 211, 153, 0.9)' : 'rgba(248, 113, 113, 0.9)'

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={edgeColor}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.8}
      />

      <polygon
        points={`${targetX},${targetY} ${targetX - 10},${targetY - 5} ${targetX - 10},${targetY + 5}`}
        fill={edgeColorBright}
      />

      <circle r={3} fill={edgeColorBright}>
        <animateMotion
          dur="3s"
          repeatCount="indefinite"
          path={d}
          begin={`${0.9 + index * 0.15}s`}
        />
      </circle>
    </g>
  )
}
