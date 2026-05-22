'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { GraphNode } from '@/lib/data/memories'
import { cleanTitle, nodeHue, type ColorMode } from '../nodeColor'
import { Planet } from './Planet'

export type SimNode2D = GraphNode & {
  _glow: number
  _radius: number
  _hue: number
  _degree: number
  x?: number
  y?: number
}

export type SimLink2D = {
  source: string
  target: string
  type: string
}

type Props = {
  nodes: SimNode2D[]
  selectedId: string | null
  hoveredId: string | null
  hubIds: Set<string>
  colorMode: ColorMode
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function PlanetCloud2D({
  nodes,
  selectedId,
  hoveredId,
  hubIds,
  colorMode,
  onSelect,
  onHover,
}: Props) {
  const groupRefs = useRef(new Map<string, THREE.Group>())

  useEffect(() => {
    const live = new Set(nodes.map((n) => n.id))
    for (const id of Array.from(groupRefs.current.keys())) {
      if (!live.has(id)) groupRefs.current.delete(id)
    }
  }, [nodes])

  useFrame(() => {
    for (const n of nodes) {
      const ref = groupRefs.current.get(n.id)
      if (!ref) continue
      ref.position.set(n.x ?? 0, n.y ?? 0, 0)
      const isSel = n.id === selectedId
      const isHov = n.id === hoveredId
      const target = isSel ? 1.55 : isHov ? 1.25 : 1.0
      const k = 0.18
      ref.scale.x += (target - ref.scale.x) * k
      ref.scale.y = ref.scale.x
      ref.scale.z = ref.scale.x
    }
  })

  return (
    <>
      {nodes.map((n) => {
        const hue = nodeHue(n, colorMode)
        const hex = `hsl(${hue}, 92%, ${56 + 14 * n._glow}%)`
        return (
          <Planet
            key={n.id}
            ref={(g) => {
              if (g) groupRefs.current.set(n.id, g)
              else groupRefs.current.delete(n.id)
            }}
            radius={n._radius}
            color={hex}
            hasRing={n.pinned}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(n.id)
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              onHover(n.id)
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              onHover(null)
            }}
          />
        )
      })}
      <Labels2D
        nodes={nodes}
        selectedId={selectedId}
        hoveredId={hoveredId}
        hubIds={hubIds}
        colorMode={colorMode}
      />
    </>
  )
}

function Labels2D({
  nodes,
  selectedId,
  hoveredId,
  hubIds,
  colorMode,
}: {
  nodes: SimNode2D[]
  selectedId: string | null
  hoveredId: string | null
  hubIds: Set<string>
  colorMode: ColorMode
}) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, SimNode2D>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  const labels: { node: SimNode2D; variant: 'hover' | 'select' | 'hub' }[] = []
  if (selectedId) {
    const n = nodeMap.get(selectedId)
    if (n) labels.push({ node: n, variant: 'select' })
  }
  if (hoveredId && hoveredId !== selectedId) {
    const n = nodeMap.get(hoveredId)
    if (n) labels.push({ node: n, variant: 'hover' })
  }
  for (const id of hubIds) {
    if (id === selectedId || id === hoveredId) continue
    const n = nodeMap.get(id)
    if (n) labels.push({ node: n, variant: 'hub' })
  }

  return (
    <>
      {labels.map((l) => (
        <FollowingLabel2D key={`${l.variant}:${l.node.id}`} node={l.node} variant={l.variant} colorMode={colorMode} />
      ))}
    </>
  )
}

function FollowingLabel2D({
  node,
  variant,
  colorMode,
}: {
  node: SimNode2D
  variant: 'hover' | 'select' | 'hub'
  colorMode: ColorMode
}) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.position.set(node.x ?? 0, (node.y ?? 0) + node._radius * 2.5 + 6, 0)
  })
  const title = cleanTitle(node.title)
  const subtitle = node.repo ?? node.type
  // Derive hex fresh from current colorMode so label glow matches the orb colour.
  const hex = `hsl(${nodeHue(node, colorMode)}, 92%, ${56 + 14 * node._glow}%)`
  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[100, 0]}>
        <div
          className="pointer-events-none whitespace-nowrap select-none"
          style={{
            padding: variant === 'hub' ? '2px 7px' : '4px 10px',
            borderRadius: '8px',
            background:
              variant === 'hub'
                ? 'rgba(8,4,18,0.55)'
                : variant === 'select'
                  ? 'rgba(8,4,18,0.94)'
                  : 'rgba(8,4,18,0.78)',
            border: `1px solid ${
              variant === 'select'
                ? hex
                : variant === 'hub'
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.10)'
            }`,
            boxShadow:
              variant === 'select'
                ? `0 0 18px ${hex}66`
                : variant === 'hub'
                  ? `0 0 12px ${hex}33`
                  : '0 4px 16px rgba(0,0,0,0.55)',
            backdropFilter: 'blur(8px)',
            transform: 'translate(-50%, -100%)',
            color: variant === 'hub' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.92)',
            fontSize: variant === 'hub' ? '10px' : '11px',
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          <div>{title}</div>
          {variant !== 'hub' && (
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      </Html>
    </group>
  )
}
