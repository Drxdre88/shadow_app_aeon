'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AetherPayload, ThoughtVisual } from '@/lib/kairos/aether-types'
import { ThoughtContainer } from './ThoughtContainer'

const DOMINION_COLOR_HUE: Record<string, number> = {
  purple:  270,
  violet:  290,
  sky:     210,
  blue:    220,
  cyan:    190,
  teal:    175,
  emerald: 150,
  green:   130,
  lime:    90,
  yellow:  55,
  amber:   40,
  orange:  25,
  red:     0,
  rose:    350,
  pink:    330,
  fuchsia: 310,
}

const HALO_PALETTE = [262, 200, 150, 32, 0, 320, 90, 220]

function hashHue(key: string | null | undefined): number {
  if (!key) return 240
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return HALO_PALETTE[h % HALO_PALETTE.length]
}

function thoughtHue(dominionColor: string | null, dominionId: string | null): number {
  if (dominionColor && dominionColor in DOMINION_COLOR_HUE) {
    return DOMINION_COLOR_HUE[dominionColor]
  }
  return hashHue(dominionId)
}

function hueToRgb(hue: number): [number, number, number] {
  const h = hue / 360
  const r = Math.abs(h * 6 - 3) - 1
  const g = 2 - Math.abs(h * 6 - 2)
  const b = 2 - Math.abs(h * 6 - 4)
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))]
}

// Seeded deterministic random — keeps positions stable between renders.
function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// Group thoughts by dominionId and cluster same-hue ones near each other.
// eureka floats up and forward; stale/low-salience push back into the haze.
function computePositions(
  visuals: ThoughtVisual[],
): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>()
  const groupMap = new Map<string | null, ThoughtVisual[]>()

  for (const v of visuals) {
    const key = v.thought.dominionId
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(v)
  }

  let groupIdx = 0
  for (const [, members] of groupMap) {
    const rng = seededRng(groupIdx * 7919 + 1)
    // Group anchor — evenly spread groups around a loose ring.
    const angle = (groupIdx / groupMap.size) * Math.PI * 2
    const groupR = 28 + rng() * 18
    const ax = Math.cos(angle) * groupR
    const az = Math.sin(angle) * groupR

    for (let i = 0; i < members.length; i++) {
      const v = members[i]
      const rng2 = seededRng(groupIdx * 997 + i * 311)
      // Scatter within group
      const scatter = 10 + rng2() * 10
      const a2 = rng2() * Math.PI * 2
      const x = ax + Math.cos(a2) * scatter
      const z = az + Math.sin(a2) * scatter

      // Depth: high salience forward, low pushed back.
      // eureka kind also gets a strong forward + upward pull.
      let y = (rng2() - 0.5) * 22 + v.thought.salience * 14
      let depthZ = -(1 - v.thought.salience) * 40
      if (v.thought.kind === 'eureka') {
        y += 12
        depthZ += 20
      }

      positions.set(v.thought.id, [x, y, z + depthZ])
    }
    groupIdx++
  }
  return positions
}

// Faint luminous line connecting two thought positions (tension filament).
function TensionFilament({
  a,
  b,
}: {
  a: [number, number, number]
  b: [number, number, number]
}) {
  const lineObj = useMemo(() => {
    const points = [new THREE.Vector3(...a), new THREE.Vector3(...b)]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.55, 0.42, 1.0),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return new THREE.Line(geometry, material)
  }, [a, b])

  return <primitive object={lineObj} />
}

type Props = {
  payload: AetherPayload
  selectedId: string | null
  onSelect?: (id: string) => void
  onHover?: (id: string | null) => void
}

export function ThoughtField({ payload, selectedId, onSelect, onHover }: Props) {
  const groupRef = useRef<THREE.Group>(null)

  // Map thoughts -> ThoughtVisual with layout positions.
  const visuals: ThoughtVisual[] = useMemo(() => {
    return payload.thoughts.map((thought) => {
      const hue = thoughtHue(thought.dominionColor, thought.dominionId)
      const radius = 2.5 + thought.salience * 6
      // eureka always glows at max; age fades dim thoughts slightly further.
      const ageFade = Math.max(0, 1 - thought.ageDays / 30)
      const glow =
        thought.kind === 'eureka'
          ? Math.max(0.92, thought.salience)
          : thought.salience * 0.85 * ageFade

      return {
        thought,
        hue,
        radius,
        glow,
        position: [0, 0, 0] as [number, number, number],
        selected: thought.id === selectedId,
      }
    })
  }, [payload.thoughts, selectedId])

  const positions = useMemo(() => computePositions(visuals), [visuals])

  // Assign computed positions.
  const positioned: ThoughtVisual[] = useMemo(
    () =>
      visuals.map((v) => ({
        ...v,
        position: positions.get(v.thought.id) ?? [0, 0, 0],
      })),
    [visuals, positions],
  )

  // Tension filament pairs — only draw if both endpoints are known.
  const filaments = useMemo(() => {
    return payload.tensions
      .map((t) => {
        const pa = positions.get(t.aId)
        const pb = positions.get(t.bId)
        if (!pa || !pb) return null
        return { key: `${t.aId}-${t.bId}`, a: pa, b: pb }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
  }, [payload.tensions, positions])

  // Gentle breathing drift — the field lives and breathes.
  const drift = useRef({ phase: 0 })
  useFrame((_, delta) => {
    if (!groupRef.current) return
    drift.current.phase += delta * 0.12
    const s = Math.sin(drift.current.phase)
    const c = Math.cos(drift.current.phase * 0.7)
    groupRef.current.rotation.y = s * 0.022
    groupRef.current.rotation.x = c * 0.014
  })

  return (
    <group ref={groupRef}>
      {filaments.map((f) => (
        <TensionFilament key={f.key} a={f.a} b={f.b} />
      ))}
      {positioned.map((v) => (
        <ThoughtContainer
          key={v.thought.id}
          {...v}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </group>
  )
}
