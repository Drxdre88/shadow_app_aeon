'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { hexToRgba, resolveAccentHex } from '@/lib/utils/colors'
import { progressBarStyle } from './progressColor'

// The lifted card's halo. Pulses with framer-motion when Smooth UI Renders is
// on; when it's off every animation is killed (data-reduce-motion), so the
// ring is rendered as a plain static highlight instead of a frozen keyframe.
export function MovingRing({ color, pulse }: { color: string; pulse: boolean }) {
  const hex = resolveAccentHex(color)
  const ring = `0 0 0 2px ${hexToRgba(hex, 0.9)}, 0 0 18px 4px ${hexToRgba(hex, 0.45)}`
  const ringWide = `0 0 0 3px ${hexToRgba(hex, 0.6)}, 0 0 34px 10px ${hexToRgba(hex, 0.3)}`
  if (!pulse) {
    return <div aria-hidden className="absolute -inset-0.5 rounded-xl pointer-events-none z-10" style={{ boxShadow: ring }} />
  }
  return (
    <motion.div
      aria-hidden
      className="absolute -inset-0.5 rounded-xl pointer-events-none z-10"
      initial={{ boxShadow: ring, opacity: 0.6 }}
      animate={{ boxShadow: [ring, ringWide, ring], opacity: [0.7, 1, 0.7] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

export function TaskCardProgressBar({ progress, dimmed }: { progress: number; dimmed: boolean }) {
  const pct = Math.min(100, Math.max(0, progress))
  const bar = progressBarStyle(pct)
  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 right-0 h-1 rounded-b-xl overflow-hidden bg-white/[0.06] pointer-events-none',
        dimmed && 'opacity-30'
      )}
      title={`${pct}% complete`}
    >
      <div
        className="relative h-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: bar.fill, boxShadow: bar.glow }}
      >
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{ background: bar.cloud, filter: 'blur(1.5px)' }}
        />
      </div>
    </div>
  )
}
