'use client'

import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import { AetherMedium } from './scene/AetherMedium'
import { AetherPostFX } from './scene/AetherPostFX'
import { AetherOverlay } from './AetherOverlay'
import { ThoughtField } from './scene/ThoughtField'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

type Props = {
  payload: AetherPayload | null
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function EmptyState() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        pointerEvents: 'none',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >
      <motion.div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
      >
        <motion.div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'rgba(160, 120, 255, 0.5)',
            boxShadow: '0 0 18px rgba(140, 90, 255, 0.6)',
          }}
          animate={{
            scale: [1, 1.7, 1],
            opacity: [0.5, 0.9, 0.5],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <p
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'rgba(200, 180, 255, 0.35)',
          }}
        >
          the Aether is forming…
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            color: 'rgba(160, 145, 220, 0.22)',
            letterSpacing: '0.1em',
          }}
        >
          synthesis runs once per day
        </p>
      </motion.div>
    </div>
  )
}

function AetherScene({
  payload,
  selectedId,
  onSelect,
}: {
  payload: AetherPayload
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <>
      <ambientLight intensity={0.18} />
      <pointLight position={[0, 80, 60]} intensity={0.9} color="#8866ff" />
      <AetherMedium intensity={1.0} />
      <ThoughtField
        payload={payload}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        autoRotate
        autoRotateSpeed={0.18}
        rotateSpeed={0.55}
        minDistance={60}
        maxDistance={380}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.88}
        target={[0, 6, 0]}
      />
      <AetherPostFX />
    </>
  )
}

export function Aether3D({ payload, selectedId, onSelect }: Props) {
  if (!payload) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020108' }}>
        <Canvas
          camera={{ position: [0, 20, 120], fov: 60, near: 1, far: 3000 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          dpr={[1, 2]}
          style={{ background: '#020108' }}
        >
          <AetherMedium intensity={0.6} />
        </Canvas>
        <EmptyState />
      </div>
    )
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: '#020108' }}
    >
      <Canvas
        camera={{ position: [0, 20, 140], fov: 60, near: 1, far: 3000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        style={{ background: '#020108' }}
        onPointerMissed={() => onSelect(null)}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            console.warn('[Aether3D] WebGL context lost — reload to recover.')
          })
        }}
      >
        <AetherScene payload={payload} selectedId={selectedId} onSelect={onSelect} />
      </Canvas>

      <AetherOverlay payload={payload} selectedId={selectedId} onSelect={onSelect} />
    </div>
  )
}
