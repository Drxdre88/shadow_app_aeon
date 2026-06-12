'use client'

import { motion } from 'framer-motion'
import { useAetherData } from './useAetherData'
import { Aether3D } from './Aether3D'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

// Aether as a Kairos view — the apex self-model rendered inside the Kairos
// main area, alongside the 3D/2D graph lenses. Owns its own data (the daily
// synthesis), not the brain graph. The skybox is shared via kairosPrefsStore,
// so the header picker drives both this and the 3D graph.
export function AetherView() {
  const { payload, loading, error } = useAetherData()

  if (loading) return <BootingFallback />

  if (error) {
    return (
      <Centered>
        <p className="text-white/30 text-sm">Failed to load Aether — {error}</p>
      </Centered>
    )
  }

  if (!payload) {
    return (
      <Centered>
        <div className="text-center space-y-2">
          <p className="text-white/50 text-sm tracking-wide">No synthesis yet</p>
          <p className="text-white/25 text-xs">Aether runs once per day. Check back after Kairos has reflected.</p>
        </div>
      </Centered>
    )
  }

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ filter: 'blur(14px) brightness(1.9) saturate(0.4)', opacity: 0 }}
      animate={{
        filter: [
          'blur(14px) brightness(1.9) saturate(0.4)',
          'blur(6px) brightness(1.3) saturate(0.7)',
          'blur(1.5px) brightness(1.05) saturate(0.95)',
          'blur(0px) brightness(1) saturate(1)',
        ],
        opacity: [0, 0.6, 0.95, 1],
      }}
      transition={{ duration: 1.4, times: [0, 0.45, 0.8, 1], ease: EASE }}
    >
      <Aether3D payload={payload} />
    </motion.div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center">{children}</div>
}

function BootingFallback() {
  return (
    <Centered>
      <motion.div
        className="flex flex-col items-center gap-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-violet-400/60"
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/25">Entering Aether</span>
      </motion.div>
    </Centered>
  )
}
