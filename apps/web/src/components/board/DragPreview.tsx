'use client'

import { motion } from 'framer-motion'
import { Merge } from 'lucide-react'
import { resolveColor } from '@/lib/utils/colors'
import { GlowCard } from '@/components/ui/GlowCard'
import type { DragEffect } from '@/stores/themeStore'

// `zoom` is the board's pinch scale: the overlay lives OUTSIDE the scaled
// wrapper (dnd-kit overlays inside transformed ancestors drift), so the
// preview scales itself to match the bird's-eye cards it hovers over. The
// top-left origin keeps the preview anchored where dnd-kit positions it.
// `hint` is the fusion cue: while the dragged card is armed to fuse into the
// card under it, the preview wears a small "Fuse" pill.
export function DragPreview({ task, effect, globalGlow, zoom = 1, hint = null }: { task: { color: string; name: string }; effect: DragEffect; globalGlow: number; zoom?: number; hint?: string | null }) {
  const colors = resolveColor(task.color || 'purple')
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

  const preview = (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      className="relative pointer-events-none"
      style={effectStyles[effect]}
    >
      <GlowCard accentColor={task.color} glowIntensity="xl" showAccentLine className="p-3 w-72">
        <h4 className="text-sm font-medium text-white line-clamp-2">{task.name}</h4>
      </GlowCard>
      {hint && (
        <span
          data-testid="drag-preview-hint"
          className="absolute -top-2 -right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white border border-white/30 bg-slate-900/90 backdrop-blur"
          style={{ boxShadow: `0 0 ${12 * mult}px ${colors.glow}` }}
        >
          <Merge className="w-3 h-3" />
          {hint}
        </span>
      )}
    </motion.div>
  )
  if (zoom === 1) return preview
  return <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>{preview}</div>
}
