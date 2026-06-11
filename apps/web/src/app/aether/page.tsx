'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { useAetherData } from '@/components/aether/useAetherData'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const Aether3D = dynamic(
  () => import('@/components/aether/Aether3D').then((m) => m.Aether3D),
  {
    ssr: false,
    loading: () => <BootingFallback />,
  }
)

export default function AetherPage() {
  const { payload, loading, error } = useAetherData()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (loading) return <BootingFallback />

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-white/30 text-sm">Failed to load Aether — {error}</p>
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-white/50 text-sm tracking-wide">No synthesis yet</p>
          <p className="text-white/25 text-xs">Aether runs once per day. Check back after Kairos has reflected.</p>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className="absolute inset-0"
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
      <Aether3D
        payload={payload}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
      />

      <FilterBar payload={payload} />
    </motion.div>
  )
}

function FilterBar({ payload }: { payload: { generatedAt: string; shifts: string[] } }) {
  const date = new Date(payload.generatedAt)
  const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 border border-white/[0.08] backdrop-blur-md">
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/35">Aether</span>
      <span className="w-px h-3 bg-white/[0.12]" />
      <span className="text-[10px] text-white/40 font-mono">{label}</span>
      {payload.shifts.length > 0 && (
        <>
          <span className="w-px h-3 bg-white/[0.12]" />
          <span className="text-[10px] text-white/40">{payload.shifts.length} shift{payload.shifts.length !== 1 ? 's' : ''}</span>
        </>
      )}
    </div>
  )
}

function BootingFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
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
    </div>
  )
}
