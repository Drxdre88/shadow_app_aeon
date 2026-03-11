'use client'

import { motion } from 'framer-motion'

interface GlowTreeEdgeProps {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  index: number
  isResolved: boolean
}

export function GlowTreeEdge({ sourceX, sourceY, targetX, targetY, index, isResolved }: GlowTreeEdgeProps) {
  const edgeColor = isResolved ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.5)'
  const edgeColorBright = isResolved ? 'rgba(52, 211, 153, 0.9)' : 'rgba(248, 113, 113, 0.9)'

  const midY = (sourceY + targetY) / 2
  const d = `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`

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
        points={`${targetX},${targetY} ${targetX - 6},${targetY - 10} ${targetX + 6},${targetY - 10}`}
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
