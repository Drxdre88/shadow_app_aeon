'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d'
import type { GraphEdge, GraphNode } from '@/lib/data/memories'
import { nodeHue, type ColorMode } from './nodeColor'
import { PlanetCloud2D, type SimNode2D, type SimLink2D } from './scene/PlanetCloud2D'
import { EdgeLayer2D } from './scene/EdgeLayer2D'
import { Backdrop2D } from './scene/Backdrop2D'
import { OrthoControls2D } from './scene/OrthoControls2D'
import { PostFX } from './scene/PostFX'
import { useKairosStore } from '@/stores/kairosStore'

export type BackdropId = 'cortex' | 'aeon' | 'art'

export const BACKDROP_URLS: Record<BackdropId, string> = {
  cortex: '/cortex/cortex_2d.png',
  aeon: '/cortex/aeon.png',
  art: '/cortex/art.png',
}

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  colorMode?: ColorMode
  backdrop?: BackdropId
}

const DAY_MS = 24 * 60 * 60 * 1000

export function Kairos2D({
  nodes,
  edges,
  selectedId,
  onSelect,
  colorMode = 'dominion',
  backdrop = 'cortex',
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const labelMode = useKairosStore((s) => s.labelMode)
  const draggingRef = useRef(false)

  // Camera state shared between OrthoControls2D and Backdrop2D via a stable ref.
  const camRef = useRef({ x: 0, y: 0, zoom: 0.9 })

  // colorMode ref keeps colorMode visible inside useFrame without re-triggering
  // the simulation — matches the pattern in PlanetCloud3D.
  const colorModeRef = useRef(colorMode)
  useEffect(() => { colorModeRef.current = colorMode }, [colorMode])

  // Build sim nodes fresh from GraphNode data — d3-force mutates nodes in place
  // so we explicitly enumerate every field to avoid carrying stale x/y/vx/vy
  // across view-switch remounts (the "spread bug" from before).
  const simNodes = useMemo<SimNode2D[]>(() => {
    const now = Date.now()
    const degree = new Map<string, number>()
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    return nodes.map((n, i) => {
      const ageDays = (now - new Date(n.createdAt).getTime()) / DAY_MS
      const recency = Math.max(0.32, 1 - ageDays / 14)
      const ang = (i / Math.max(nodes.length, 1)) * Math.PI * 2
      const seedR = 200 + Math.random() * 100
      const hue = nodeHue(n, colorModeRef.current)
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
        dominionId: n.dominionId,
        dominionName: n.dominionName,
        dominionColor: n.dominionColor,
        x: Math.cos(ang) * seedR,
        y: Math.sin(ang) * seedR,
        _radius: n.pinned ? 7.5 : 4.2 + recency * 2.4,
        _degree: degree.get(n.id) ?? 0,
        _hue: hue,
        _glow: recency,
      }
    })
  // colorModeRef is stable — intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const nodeById = useMemo(() => {
    const m = new Map<string, SimNode2D>()
    for (const n of simNodes) m.set(n.id, n)
    return m
  }, [simNodes])

  const simLinks = useMemo<SimLink2D[]>(
    () =>
      edges
        .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, type: e.type })),
    [edges, nodeById],
  )

  // d3-force simulation — 2D mode (numDimensions=2), z stays 0.
  useEffect(() => {
    if (simNodes.length === 0) return
    const sim = forceSimulation(simNodes, 2)
      .force('charge', forceManyBody().strength(-180).distanceMax(600))
      .force(
        'link',
        forceLink(simLinks).id((n: { id: string }) => n.id).distance(70).strength(0.35),
      )
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.025)
    return () => { sim.stop() }
  }, [simNodes, simLinks])

  // Suppress deselect when the pointer-up was at the end of a pan drag.
  const handlePointerMissed = useCallback(() => {
    if (draggingRef.current) return
    onSelect(null)
  }, [onSelect])

  return (
    <div className="absolute inset-0">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 0.9, near: 1, far: 2000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        style={{ background: '#03020a' }}
        onPointerMissed={handlePointerMissed}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            if (typeof console !== 'undefined') console.warn('WebGL context lost — reload to recover.')
          })
        }}
      >
        <Backdrop2D url={BACKDROP_URLS[backdrop]} camRef={camRef} />

        <EdgeLayer2D links={simLinks} nodeById={nodeById} />

        <PlanetCloud2D
          nodes={simNodes}
          selectedId={selectedId}
          hoveredId={hoveredId}
          colorMode={colorMode}
          labelMode={labelMode}
          onSelect={onSelect}
          onHover={setHoveredId}
        />

        <OrthoControls2D
          camRef={camRef}
          onDraggingChange={(d) => { draggingRef.current = d }}
        />

        <PostFX />
      </Canvas>
    </div>
  )
}
