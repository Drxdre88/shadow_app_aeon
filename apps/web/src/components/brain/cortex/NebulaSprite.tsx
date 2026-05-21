'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function buildTexture(): THREE.CanvasTexture {
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0,   'rgba(255,255,255,0.9)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.4)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)')
  g.addColorStop(1,   'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 800; i++) {
    const ang = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), 1.4) * size * 0.45
    const x = size / 2 + Math.cos(ang) * rad
    const y = size / 2 + Math.sin(ang) * rad
    const dotR = 2 + Math.random() * 5
    ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.07})`
    ctx.beginPath()
    ctx.arc(x, y, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function NebulaSprite({
  position,
  color,
  scale,
  driftSeed,
  opacity = 0.55,
}: {
  position: [number, number, number]
  color: string
  scale: number
  driftSeed: number
  opacity?: number
}) {
  const ref = useRef<THREE.Mesh>(null)
  const tex = useMemo(buildTexture, [])
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.rotation.z = Math.sin(t * 0.04 + driftSeed) * 0.18
    const breathe = 1 + Math.sin(t * 0.16 + driftSeed) * 0.05
    ref.current.scale.set(scale * breathe, scale * breathe, 1)
  })
  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={tex}
        color={color}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={opacity}
      />
    </mesh>
  )
}
