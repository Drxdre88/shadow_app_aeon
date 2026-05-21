'use client'

import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import R3fForceGraph from 'r3f-forcegraph'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'
import { edgeColor, isAutoEdge, nodeHue, type ColorMode } from './nodeColor'
import { SUN_DIR } from './cortex/params'
import { Backdrop } from './cortex/Backdrop'
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
      dpr={[1, 2]}
      style={{ background: '#000000' }}
      onPointerMissed={() => onSelect(null)}
      onCreated={({ gl }) => {
        const canvas = gl.domElement
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          // Let the user know in dev so we don't silently white-screen.
          if (typeof console !== 'undefined') console.warn('WebGL context lost — reload to recover.')
        })
      }}
    >
      <ambientLight intensity={0.22} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(800)} intensity={1.2} color="#fff4d6" />

      <Backdrop />

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
      linkOpacity={0.85}
      linkWidth={(raw: unknown) => (isAutoEdge((raw as SceneLink).type) ? 1.0 : 2.8)}
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
