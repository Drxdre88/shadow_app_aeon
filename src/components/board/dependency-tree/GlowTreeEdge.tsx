'use client'

import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'

interface GlowTreeEdgeProps {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  index: number
}

export function GlowTreeEdge({ sourceX, sourceY, targetX, targetY, index }: GlowTreeEdgeProps) {
  const { colors: themeColors } = useThemeStore()
  const glowColor = themeColors.glowColor || 'rgba(168, 85, 247, 0.6)'

  const midY = (sourceY + targetY) / 2
  const d = `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`

  const pathLength = Math.sqrt(
    Math.pow(targetX - sourceX, 2) + Math.pow(targetY - sourceY, 2)
  ) * 1.5

  return (
    <g>
      <defs>
        <filter id={`edge-glow-${index}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <motion.path
        d={d}
        fill="none"
        stroke={glowColor}
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

      <motion.circle
        r={3}
        fill={glowColor}
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
