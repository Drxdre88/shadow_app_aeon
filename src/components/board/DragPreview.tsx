'use client'

import { motion } from 'framer-motion'
import { AccentColor, colorConfig } from '@/lib/utils/colors'
import { GlowCard } from '@/components/ui/GlowCard'
import type { DragEffect } from '@/stores/themeStore'

export function DragPreview({ task, effect, globalGlow }: { task: any; effect: DragEffect; globalGlow: number }) {
  const colors = colorConfig[task.color as AccentColor]
  const mult = globalGlow / 75

  const effectStyles = {
    glow: {
      boxShadow: `0 0 ${60 * mult}px ${20 * mult}px ${colors.glow}, 0 0 ${100 * mult}px ${40 * mult}px ${colors.glowDark}`,
      transform: 'scale(1.05) rotate(2deg)',
    },
    ghost: {
      opacity: 0.8,
      boxShadow: `0 20px 40px rgba(0,0,0,0.5)`,
      transform: 'scale(1.02)',
      filter: 'blur(0.5px)',
    },
    lightning: {
      boxShadow: `0 0 ${30 * mult}px ${10 * mult}px ${colors.glow}, inset 0 0 ${20 * mult}px ${colors.glowDark}`,
      transform: 'scale(1.08)',
      animation: 'pulse 0.3s ease-in-out infinite alternate',
    },
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      className="pointer-events-none"
      style={effectStyles[effect]}
    >
      <GlowCard accentColor={task.color} glowIntensity="xl" showAccentLine className="p-3 w-72">
        <h4 className="text-sm font-medium text-white line-clamp-2">{task.name}</h4>
      </GlowCard>
    </motion.div>
  )
}
