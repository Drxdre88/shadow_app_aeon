'use client'

import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import R3fForceGraph from 'r3f-forcegraph'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'
import { edgeColor, isAutoEdge, nodeHue, type ColorMode } from './nodeColor'
import { SUN_DIR } from './cortex/params'
import { CinematicStarfield } from './cortex/CinematicStarfield'
import { NebulaSprite } from './cortex/NebulaSprite'
import { RaymarchedNebula } from './cortex/RaymarchedNebula'
import { PostFX } from './cortex/PostFX'
import { PlanetCloud, type SceneNode } from './cortex/PlanetCloud'

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  colorMode?: ColorMode
}

type SceneLink = { source: string; target: string; type: string; _color: string }

const DAY_MS = 24 * 60 * 60 * 1000

export function Cortex3D({ nodes, edges, selectedId, onSelect, colorMode = 'realm' }: Props) {
  const sceneData = useMemo(() => buildSceneData(nodes, edges, colorMode), [nodes, edges, colorMode])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const hubIds = useMemo(() => {
    const sorted = [...sceneData.nodes].sort((a, b) => b._degree - a._degree)
    return new Set(sorted.slice(0, Math.min(5, sorted.length)).map((n) => n.id))
  }, [sceneData.nodes])

  return (
    <Canvas
      camera={{ position: [0, 0, 380], fov: 55, near: 1, far: 5000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: '#000000' }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.18} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(800)} intensity={1.2} color="#fff4d6" />

      <CinematicStarfield />

      <NebulaSprite position={[ 280,  120, -250]} color="#7c3aed" scale={520} driftSeed={0.12} opacity={0.55} />
      <NebulaSprite position={[-300,  -60, -300]} color="#0ea5e9" scale={580} driftSeed={0.43} opacity={0.50} />
      <NebulaSprite position={[  60,  340, -180]} color="#ec4899" scale={420} driftSeed={0.71} opacity={0.45} />
      <NebulaSprite position={[   0,    0, -460]} color="#f59e0b" scale={700} driftSeed={0.91} opacity={0.35} />
      <NebulaSprite position={[-180, -280, -220]} color="#a855f7" scale={380} driftSeed={0.27} opacity={0.40} />

      <RaymarchedNebula center={[ 200,  100, -350]} radius={180} color="#a855f7" opacity={0.55} driftSeed={0.4} />
      <RaymarchedNebula center={[-220,  -80, -400]} radius={220} color="#22d3ee" opacity={0.5}  driftSeed={0.7} />

      <EdgeGraph data={sceneData} />
      <PlanetCloud
        nodes={sceneData.nodes}
        selectedId={selectedId}
        hoveredId={hoveredId}
        hubIds={hubIds}
        colorMode={colorMode}
        onSelect={onSelect}
        onHover={setHoveredId}
      />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.28}
        rotateSpeed={0.6}
        minDistance={120}
        maxDistance={1500}
      />

      <PostFX />
    </Canvas>
  )
}

// Force-graph is responsible only for edges + the force simulation that writes
// x/y/z back into our node objects. nodeThreeObject returns an empty Object3D
// so the graph doesn't render its own spheres — PlanetCloud renders the visual
// planets in JSX and reads the simulated positions each frame.
function EdgeGraph({ data }: { data: { nodes: SceneNode[]; links: SceneLink[] } }) {
  const fgRef = useRef<{ tickFrame: () => void } | undefined>(undefined)
  useFrame(() => fgRef.current?.tickFrame())

  return (
    <R3fForceGraph
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={fgRef as any}
      graphData={data}
      nodeRelSize={4}
      nodeThreeObject={() => new THREE.Object3D()}
      nodeThreeObjectExtend={false}
      linkColor={(raw: unknown) => (raw as SceneLink)._color}
      linkOpacity={0.55}
      linkWidth={(raw: unknown) => (isAutoEdge((raw as SceneLink).type) ? 0.6 : 2.0)}
      linkDirectionalParticles={(raw: unknown) => {
        const t = (raw as SceneLink).type
        if (t === 'supports') return 4
        if (t === 'relates' || t === 'refers_to') return 2
        if (t === 'auto-repo') return 2
        if (t === 'auto-day') return 1
        return 0
      }}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleWidth={1.7}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.32}
      warmupTicks={120}
      cooldownTicks={Infinity}
    />
  )
}

function buildSceneData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  colorMode: ColorMode,
): { nodes: SceneNode[]; links: SceneLink[] } {
  const now = Date.now()
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  const sceneNodes: SceneNode[] = nodes.map((n) => {
    const ageDays = (now - new Date(n.createdAt).getTime()) / DAY_MS
    const recency = Math.max(0.32, 1 - ageDays / 14)
    const hue = nodeHue(n, colorMode)
    const hex = `hsl(${hue}, 92%, ${56 + 14 * recency}%)`
    return {
      ...n,
      _hex: hex,
      _glow: recency,
      _radius: n.pinned ? 7.5 : 4.2 + recency * 2.4,
      _hue: hue,
      _degree: degree.get(n.id) ?? 0,
    }
  })
  const sceneLinks: SceneLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
    _color: edgeColor(e.type),
  }))
  return { nodes: sceneNodes, links: sceneLinks }
}
