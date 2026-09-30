'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type * as THREE from 'three'
import { cleanTitle } from '../nodeColor'
import { labelRecencyCutoff, type LabelMode } from '@/stores/kairosStore'
import type { SceneNode } from '../scene/PlanetCloud'

// Same label set + styling as scene/PlanetCloud's PlanetLabels (not exported
// there): selected, hovered, plus recency "hub" labels per labelMode.
export function GalaxyLabels({
  nodes,
  selectedId,
  hoveredId,
  labelMode,
}: {
  nodes: SceneNode[]
  selectedId: string | null
  hoveredId: string | null
  labelMode: LabelMode
}) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, SceneNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  const cutoff = useMemo(() => labelRecencyCutoff(labelMode), [labelMode])

  const labels: { node: SceneNode; variant: 'hover' | 'select' | 'hub' }[] = []
  if (selectedId) {
    const n = nodeMap.get(selectedId)
    if (n) labels.push({ node: n, variant: 'select' })
  }
  if (hoveredId && hoveredId !== selectedId) {
    const n = nodeMap.get(hoveredId)
    if (n) labels.push({ node: n, variant: 'hover' })
  }
  if (cutoff !== null) {
    for (const n of nodes) {
      if (n.id === selectedId || n.id === hoveredId) continue
      if (new Date(n.createdAt).getTime() >= cutoff) labels.push({ node: n, variant: 'hub' })
    }
  }

  return (
    <>
      {labels.map((l) => (
        <FollowingLabel key={`${l.variant}:${l.node.id}`} node={l.node} variant={l.variant} />
      ))}
    </>
  )
}

function FollowingLabel({ node, variant }: { node: SceneNode; variant: 'hover' | 'select' | 'hub' }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.position.set(node.x ?? 0, (node.y ?? 0) + node._radius * 2.5 + 6, node.z ?? 0)
  })
  const title = node.aiTitle ?? cleanTitle(node.title)
  const subtitle = node.repo ?? node.type
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
                ? node._hex
                : variant === 'hub'
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.10)'
            }`,
            boxShadow:
              variant === 'select'
                ? `0 0 18px ${node._hex}66`
                : variant === 'hub'
                  ? `0 0 12px ${node._hex}33`
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
