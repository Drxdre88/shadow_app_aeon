'use client'

import { motion } from 'framer-motion'
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
    const filterId = `arrow-glow-${index}`
    const haloId = `arrow-halo-${index}`
    const markerId = `arrow-marker-${index}`
    const glowMult = lineGlow / 60
    const haloWidth = Math.max(lineWidth * 3, 4) * glowMult
    const blurStd = Math.max(1, 4 * glowMult)
    const haloBlurStd = Math.max(1, 6 * glowMult)
    const dashArray = lineStyle === 'dashed' ? '8 4' : lineStyle === 'dotted' ? '2 4' : undefined
    const strokeColor = sameColor ? sHex : `url(#${gradId})`
    const delay = 0.2 + index * 0.1

    return (
      <g>
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={blurStd} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={haloId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={haloBlurStd} />
          </filter>
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
          <motion.path
            d={d}
            fill="none"
            stroke={sHex}
            strokeWidth={haloWidth}
            strokeLinecap="round"
            filter={`url(#${haloId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ delay, duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <motion.path
          d={d}
          fill="none"
          stroke={strokeColor}
          strokeWidth={lineWidth}
          strokeDasharray={dashArray}
          strokeLinecap="round"
          filter={lineGlow > 0 ? `url(#${filterId})` : undefined}
          markerEnd={`url(#${markerId})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay, duration: 0.4, ease: 'easeOut' }}
        />
      </g>
    )
  }

  const edgeColor = isResolved ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.5)'
  const edgeColorBright = isResolved ? 'rgba(52, 211, 153, 0.9)' : 'rgba(248, 113, 113, 0.9)'

  return (
    <g>
      <defs>
        <filter id={`edge-glow-${index}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <motion.path
        d={d}
        fill="none"
        stroke={edgeColor}
        strokeWidth={2}
        strokeLinecap="round"
        filter={`url(#edge-glow-${index})`}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.8 }}
        transition={{
          pathLength: { delay: 0.3 + index * 0.15, duration: 0.6, ease: 'easeInOut' },
          opacity: { delay: 0.3 + index * 0.15, duration: 0.3 },
        }}
      />

      <motion.polygon
        points={`${targetX},${targetY} ${targetX - 10},${targetY - 5} ${targetX - 10},${targetY + 5}`}
        fill={edgeColorBright}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 + index * 0.15 + 0.5, duration: 0.2 }}
        filter={`url(#edge-glow-${index})`}
      />

      <motion.circle
        r={3}
        fill={edgeColorBright}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{
          delay: 0.9 + index * 0.15,
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <animateMotion
          dur="3s"
          repeatCount="indefinite"
          path={d}
          begin={`${0.9 + index * 0.15}s`}
        />
      </motion.circle>
    </g>
  )
}
