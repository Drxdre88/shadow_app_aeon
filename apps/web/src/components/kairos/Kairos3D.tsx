'use client'

import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import R3fForceGraph from 'r3f-forcegraph'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'
import { edgeColor, type ColorMode } from './nodeColor'
import { effectiveConfidence } from '@/lib/kairos/confidence'
import { SUN_DIR } from './scene/params'
import { Backdrop } from './scene/Backdrop'
import { PostFX } from './scene/PostFX'
import type { SceneNode } from './scene/PlanetCloud'
import { buildGalaxyBuffers } from './galaxy/buffers'
import { GalaxyEdges } from './galaxy/GalaxyEdges'
import { GalaxyOrbs } from './galaxy/GalaxyOrbs'
import { GalaxyLabels } from './galaxy/GalaxyLabels'
import { useKairosStore } from '@/stores/kairosStore'
import { SKYBOX_BY_ID, type SkyboxId } from '@/components/skybox/skyboxes'

export type { SkyboxId }

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  colorMode?: ColorMode
  skybox?: SkyboxId
}

type SceneLink = { source: string; target: string; type: string; _color: string }

const DAY_MS = 24 * 60 * 60 * 1000

export function Kairos3D({ nodes, edges, selectedId, onSelect, colorMode = 'dominion', skybox = 'lunar-4k' }: Props) {
  // Scene data is intentionally NOT keyed on colorMode — that would rebuild
  // the node array on every toggle and force-graph would restart the
  // simulation, jumping all planets back to seed positions. Colour is derived
  // per-instance from `colorMode` in GalaxyOrbs instead.
  const sceneData = useMemo(() => buildSceneData(nodes, edges), [nodes, edges])
  // Instance / edge buffers are built once per data load; per-frame work only
  // rewrites positions into them. Draw objects stay constant w.r.t. node count.
  const buffers = useMemo(() => buildGalaxyBuffers(sceneData.nodes, sceneData.links), [sceneData])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const labelMode = useKairosStore((s) => s.labelMode)

  return (
    <Canvas
      camera={{ position: [0, -260, 320], fov: 68, near: 1, far: 5000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      style={{ background: '#000000' }}
      onPointerMissed={() => onSelect(null)}
      onCreated={({ gl, scene }) => {
        // Dim the skybox so the planets read as the brightest thing in frame.
        // backgroundIntensity is multiplied into the texture sample before
        // tonemapping; 0.55 keeps the painted scene visible but knocks back
        // the bright lunar surface that was washing out the orbs.
        scene.backgroundIntensity = 0.55
        const canvas = gl.domElement
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          if (typeof console !== 'undefined') console.warn('WebGL context lost — reload to recover.')
        })
      }}
    >
      <ambientLight intensity={0.22} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(800)} intensity={1.2} color="#fff4d6" />

      <Backdrop url={SKYBOX_BY_ID[skybox].url} />

      <ForceLayout data={sceneData} />
      <GalaxyEdges nodes={sceneData.nodes} buffers={buffers} />
      <GalaxyOrbs
        nodes={sceneData.nodes}
        buffers={buffers}
        colorMode={colorMode}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onSelect={onSelect}
        onHover={setHoveredId}
      />
      <GalaxyLabels nodes={sceneData.nodes} selectedId={selectedId} hoveredId={hoveredId} labelMode={labelMode} />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.22}
        rotateSpeed={0.55}
        minDistance={120}
        maxDistance={1500}
        // Polar clamp keeps the viewer "on the ground" looking up at the
        // neuron cluster overhead. Widened from [0.70π, 0.98π] to give more
        // vertical freedom while still preventing a full downward dive into
        // the painted lunar foreground.
        minPolarAngle={Math.PI * 0.55}
        maxPolarAngle={Math.PI * 1.00}
        target={[0, 60, 0]}
      />

      <PostFX />
    </Canvas>
  )
}

// Force-graph now runs ONLY the d3 force simulation that writes x/y/z back
// into our node objects. Node and link visibility are off, so it creates zero
// THREE objects (previously: one Object3D per node, one cylinder/tube mesh per
// edge and one sphere mesh per directional particle — tens of thousands of
// draw calls at full load). Rendering lives in galaxy/: instanced orbs,
// batched fat-line edges per style (tension still curved at 0.35, supersedes
// 1.4, auto 1.0, semantic 2.8) and one instanced particle batch.
function ForceLayout({ data }: { data: { nodes: SceneNode[]; links: SceneLink[] } }) {
  const fgRef = useRef<{ tickFrame: () => void } | undefined>(undefined)
  useFrame(() => fgRef.current?.tickFrame())

  return (
    <R3fForceGraph
      ref={fgRef as any}
      graphData={data}
      nodeVisibility={false}
      linkVisibility={false}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.45}
      warmupTicks={150}
      cooldownTicks={600}
    />
  )
}

function buildSceneData(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: SceneNode[]; links: SceneLink[] } {
  const now = Date.now()
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  // Explicitly construct fresh node objects — r3f-forcegraph and d3-force
  // mutate nodes in place (adding x/y/z/vx/vy/...). Spreading would carry
  // those mutations across remounts (e.g. switching 3D → 2D → 3D) and the
  // new simulation would inherit stale positions, breaking the layout.
  const sceneNodes: SceneNode[] = nodes.map((n) => {
    const ageDays = (now - new Date(n.createdAt).getTime()) / DAY_MS
    const recency = Math.max(0.32, 1 - ageDays / 14)
    // Phase 2 visual grammar — dual encoding:
    //   size    = recency + pinned (unchanged)
    //   brightness = confidence, decayed the SAME way retrieval decays it
    //     (effectiveConfidence off updatedAt) so the galaxy and search agree:
    //     a sure, reinforced belief glows; a low-trust or stale one dims.
    // Superseded / expired memories go ghostly-dim regardless of their prior —
    // they are retired beliefs, present but receded.
    const isGhost = n.supersededAt != null || (n.invalidAt != null && new Date(n.invalidAt).getTime() <= now)
    const effConf = effectiveConfidence({ confidence: n.confidence, updatedAt: n.updatedAt, pinned: n.pinned }, now)
    const glow = isGhost ? 0.22 : Math.max(0.28, Math.min(1, effConf * 1.1))
    return {
      id: n.id,
      title: n.title,
      aiTitle: n.aiTitle,
      type: n.type,
      source: n.source,
      realmId: n.realmId,
      projectId: n.projectId,
      taskId: n.taskId,
      repo: n.repo,
      tags: n.tags,
      pinned: n.pinned,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      confidence: n.confidence,
      supersededAt: n.supersededAt,
      supersededById: n.supersededById,
      invalidAt: n.invalidAt,
      dominionId: n.dominionId,
      dominionName: n.dominionName,
      dominionColor: n.dominionColor,
      _hex: '#888888',
      _glow: glow,
      _radius: (n.pinned ? 7.5 : 4.2 + recency * 2.4) * (isGhost ? 0.7 : 1),
      _hue: 240,
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
