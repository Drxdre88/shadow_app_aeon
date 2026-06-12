'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AetherTension } from '@/lib/kairos/aether-types'
import type { ThoughtLayoutItem } from '../useThoughtLayout'
import { useAetherUi } from '../useAetherUi'
import { ThoughtContainer } from './ThoughtContainer'

// A curved, additive glow arc between two thoughts in tension — a visible
// "trail of thought" rather than the old 1px straight line. Gently pulses.
function TensionArc({
  a,
  b,
}: {
  a: [number, number, number]
  b: [number, number, number]
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const mesh = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const mid = va.clone().add(vb).multiplyScalar(0.5)
    mid.y += va.distanceTo(vb) * 0.2 // lift the midpoint into an arc
    const curve = new THREE.QuadraticBezierCurve3(va, mid, vb)
    const geometry = new THREE.TubeGeometry(curve, 28, 0.55, 6, false)
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.6, 0.45, 1.0),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    matRef.current = material
    return new THREE.Mesh(geometry, material)
  }, [a, b])

  const phase = useMemo(() => Math.random() * 6.28, [])
  useFrame((state) => {
    if (matRef.current) {
      matRef.current.opacity = 0.24 + 0.16 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 0.7 + phase))
    }
  })

  return <primitive object={mesh} />
}

type Props = {
  items: ThoughtLayoutItem[]
  positions: Map<string, [number, number, number]>
  tensions: AetherTension[]
}

export function ThoughtField({ items, positions, tensions }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const selectedId = useAetherUi((s) => s.selectedId)
  const hoveredId = useAetherUi((s) => s.hoveredId)
  const select = useAetherUi((s) => s.select)
  const hover = useAetherUi((s) => s.hover)

  const arcs = useMemo(() => {
    return tensions
      .map((t) => {
        const pa = positions.get(t.aId)
        const pb = positions.get(t.bId)
        if (!pa || !pb) return null
        return { key: `${t.aId}-${t.bId}`, a: pa, b: pb }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
  }, [tensions, positions])

  const drift = useRef({ phase: 0 })
  useFrame((_, delta) => {
    if (!groupRef.current) return
    drift.current.phase += delta * 0.12
    groupRef.current.rotation.y = Math.sin(drift.current.phase) * 0.022
    groupRef.current.rotation.x = Math.cos(drift.current.phase * 0.7) * 0.014
  })

  return (
    <group ref={groupRef}>
      {arcs.map((f) => (
        <TensionArc key={f.key} a={f.a} b={f.b} />
      ))}
      {items.map((v) => (
        <ThoughtContainer
          key={v.thought.id}
          thought={v.thought}
          hue={v.hue}
          radius={v.radius}
          glow={v.glow}
          seed={v.seed}
          position={v.position}
          selected={v.thought.id === selectedId}
          hovered={v.thought.id === hoveredId}
          dimmed={selectedId !== null && v.thought.id !== selectedId}
          onSelect={select}
          onHover={hover}
        />
      ))}
    </group>
  )
}
