'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import { Backdrop } from '@/components/kairos/scene/Backdrop'
import { AetherPostFX } from './scene/AetherPostFX'
import { AetherOverlay } from './AetherOverlay'
import { ThoughtField } from './scene/ThoughtField'
import { ThoughtLabels } from './scene/ThoughtLabels'
import { useThoughtLayout } from './useThoughtLayout'
import { useAetherUi } from './useAetherUi'
import { useKairosPrefsStore } from '@/stores/kairosPrefsStore'
import { SKYBOX_BY_ID } from '@/components/skybox/skyboxes'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

// Fallback used only before a skybox is chosen / on the empty-state canvas.
const AETHER_SKYBOX_URL = '/cortex/skybox-nebula-4k.png'

function EmptyState() {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none',
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
          style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(160, 120, 255, 0.5)', boxShadow: '0 0 18px rgba(140, 90, 255, 0.6)' }}
          animate={{ scale: [1, 1.7, 1], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(200, 180, 255, 0.35)' }}>
          the Aether is forming…
        </p>
        <p style={{ margin: 0, fontSize: 10, color: 'rgba(160, 145, 220, 0.22)', letterSpacing: '0.1em' }}>
          synthesis runs once per day
        </p>
      </motion.div>
    </div>
  )
}

function AetherScene({ payload }: { payload: AetherPayload }) {
  const { items, positions } = useThoughtLayout(payload)
  // Shared with the Kairos 3D graph — the header picker drives both.
  const skybox = useKairosPrefsStore((s) => s.skybox)
  const skyUrl = SKYBOX_BY_ID[skybox]?.url ?? AETHER_SKYBOX_URL

  return (
    <>
      {/* Skybox doubles as the environment map — orbs reflect it, which is what
          makes them read as real spheres. Backdrop loads both PNG and HDR and
          PMREM-processes it into scene.environment for the reflections. */}
      <Backdrop url={skyUrl} environment />
      {/* Dim key light for a specular highlight that sells the spherical form. */}
      <directionalLight position={[6, 9, 5]} intensity={0.7} color="#cdbcff" />
      <ambientLight intensity={0.12} />
      <ThoughtField items={items} positions={positions} tensions={payload.tensions} />
      <ThoughtLabels items={items} />
      <OrbitControls
        makeDefault
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

export function Aether3D({ payload }: { payload: AetherPayload | null }) {
  const select = useAetherUi((s) => s.select)

  if (!payload) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020108' }}>
        <Canvas
          camera={{ position: [0, 20, 120], fov: 60, near: 1, far: 3000 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          dpr={[1, 1.5]}
          style={{ background: '#020108' }}
        >
          <Backdrop url={AETHER_SKYBOX_URL} />
        </Canvas>
        <EmptyState />
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020108' }}>
      <Canvas
        camera={{ position: [0, 20, 140], fov: 60, near: 1, far: 3000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
        style={{ background: '#020108' }}
        onPointerMissed={() => select(null)}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            console.warn('[Aether3D] WebGL context lost — reload to recover.')
          })
        }}
      >
        <AetherScene payload={payload} />
      </Canvas>

      <AetherOverlay payload={payload} />
    </div>
  )
}
