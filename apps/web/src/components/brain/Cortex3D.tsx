'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html } from '@react-three/drei'
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
  Noise,
} from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import R3fForceGraph from 'r3f-forcegraph'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'
import { nodeHue, edgeColor, isAutoEdge, type ColorMode } from './nodeColor'
import { useCortexTextures, usePlanetPicker } from './useCortexTextures'

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  colorMode?: ColorMode
}

type SceneNode = GraphNode & {
  _hex: string
  _glow: number
  _radius: number
  _hue: number
  _degree: number
  x?: number
  y?: number
  z?: number
}
type SceneLink = { source: string; target: string; type: string; _color: string }

const DAY_MS = 24 * 60 * 60 * 1000

export function Cortex3D({ nodes, edges, selectedId, onSelect, colorMode = 'realm' }: Props) {
  const sceneData = useMemo(() => buildSceneData(nodes, edges, colorMode), [nodes, edges, colorMode])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const nodeMap = useMemo(() => {
    const m = new Map<string, SceneNode>()
    for (const n of sceneData.nodes) m.set(n.id, n)
    return m
  }, [sceneData.nodes])

  // Top-N hub nodes (by degree) get always-on labels.
  const hubIds = useMemo(() => {
    const sorted = [...sceneData.nodes].sort((a, b) => b._degree - a._degree)
    return new Set(sorted.slice(0, Math.min(5, sorted.length)).map((n) => n.id))
  }, [sceneData.nodes])

  return (
    <Canvas
      camera={{ position: [0, 0, 380], fov: 55, near: 1, far: 5000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: 'radial-gradient(circle at 50% 50%, #0d0420 0%, #04020a 60%, #000000 100%)' }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[300, 200, 200]} intensity={0.75} color="#a78bfa" />
      <pointLight position={[-280, -180, 100]} intensity={0.5} color="#38bdf8" />
      <pointLight position={[0, 300, -200]} intensity={0.4} color="#f0abfc" />

      <SkyboxAndBackground />
      <Stars radius={1100} depth={160} count={4500} factor={5.5} saturation={0.35} fade speed={0.25} />
      <NebulaField />

      <Graph
        data={sceneData}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onSelect={onSelect}
        onHover={setHoveredId}
      />

      <FollowingLabel node={hoveredId && hoveredId !== selectedId ? nodeMap.get(hoveredId) : undefined} variant="hover" />
      <FollowingLabel node={selectedId ? nodeMap.get(selectedId) : undefined} variant="select" />
      {[...hubIds].map((id) => {
        if (id === selectedId || id === hoveredId) return null
        const n = nodeMap.get(id)
        if (!n) return null
        return <FollowingLabel key={id} node={n} variant="hub" />
      })}

      <Spaceship />

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

      <EffectComposer multisampling={0}>
        <Bloom
          luminanceThreshold={0.16}
          luminanceSmoothing={0.88}
          intensity={2.1}
          radius={0.82}
          mipmapBlur
        />
        <ChromaticAberration
          offset={[0.0008, 0.0014] as unknown as [number, number]}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={false}
          modulationOffset={0}
        />
        <Vignette eskil={false} offset={0.18} darkness={0.85} />
        <Noise opacity={0.045} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </Canvas>
  )
}

// ─── Skybox + IBL from a single equirectangular PNG ───────────────────────

function SkyboxAndBackground() {
  const { scene } = useThree()
  const bundle = useCortexTextures()
  useEffect(() => {
    if (!bundle.skybox) return
    scene.background = bundle.skybox
    scene.environment = bundle.skybox
    return () => {
      // Don't clear — another scene wouldn't use the same THREE.Scene anyway.
    }
  }, [bundle.skybox, scene])
  return null
}

// ─── Force graph wrapper ──────────────────────────────────────────────────

function Graph({
  data, selectedId, hoveredId, onSelect, onHover,
}: {
  data: { nodes: SceneNode[]; links: SceneLink[] }
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}) {
  const fgRef = useRef<{ tickFrame: () => void } | undefined>(undefined)
  useFrame(() => fgRef.current?.tickFrame())

  const bundle = useCortexTextures()
  const pickPlanet = usePlanetPicker(bundle)

  return (
    <R3fForceGraph
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={fgRef as any}
      graphData={data}
      nodeAutoColorBy={undefined}
      nodeOpacity={1}
      nodeRelSize={4}
      nodeThreeObject={(raw: unknown) => {
        const n = raw as SceneNode
        const planet = pickPlanet(n.repo ?? n.realmId ?? n.type)
        const rings = n.pinned ? bundle.rings : null
        return buildNodeMesh(n, n.id === selectedId, n.id === hoveredId, planet, rings)
      }}
      nodeThreeObjectExtend={false}
      linkColor={(raw: unknown) => (raw as SceneLink)._color}
      linkOpacity={0.6}
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
      onNodeClick={(node: unknown) => onSelect((node as SceneNode).id)}
      onNodeHover={(node: unknown) => onHover(node ? (node as SceneNode).id : null)}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.32}
      warmupTicks={120}
      cooldownTicks={Infinity}
    />
  )
}

// ─── Node mesh ────────────────────────────────────────────────────────────

function buildNodeMesh(
  node: SceneNode,
  isSelected: boolean,
  isHovered: boolean,
  planetMap: THREE.Texture | null,
  ringsMap: THREE.Texture | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const color = new THREE.Color(node._hex)
  const r = node._radius * (isSelected ? 1.6 : isHovered ? 1.28 : 1)
  const emissiveBoost = node._glow * (isSelected ? 2.4 : isHovered ? 1.7 : 1.0)

  // Core sphere: textured planet if a map is available, else flat emissive.
  const coreMaterial = planetMap
    ? new THREE.MeshStandardMaterial({
        map: planetMap,
        emissive: color,
        emissiveIntensity: 0.35 * emissiveBoost,
        roughness: 0.55,
        metalness: 0.05,
        toneMapped: true,
      })
    : new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.8 * emissiveBoost,
        toneMapped: false,
        roughness: 0.35,
        metalness: 0.1,
      })

  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 36, 36), coreMaterial)
  // Slight axial tilt so the texture seam doesn't always face camera.
  core.rotation.z = (node._hue * Math.PI) / 180
  core.rotation.y = Math.random() * Math.PI * 2
  group.add(core)

  // Atmospheric inner halo — additive shell tinted to the node colour.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.65, 16, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: planetMap ? 0.14 * emissiveBoost : 0.32 * emissiveBoost,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  )
  group.add(halo)

  // Outer corona — bloomy bleed.
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(r * 3.2, 14, 14),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: planetMap ? 0.05 * emissiveBoost : 0.08 * emissiveBoost,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  )
  group.add(corona)

  // Pinned planets get Saturn-style rings if the texture is available.
  if (node.pinned) {
    if (ringsMap) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.6, r * 2.6, 64),
        new THREE.MeshBasicMaterial({
          map: ringsMap,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      )
      ring.rotation.x = Math.PI * 0.42
      ring.rotation.y = Math.PI * 0.08
      group.add(ring)
    } else {
      const flatRing = new THREE.Mesh(
        new THREE.RingGeometry(r * 2.2, r * 2.4, 48),
        new THREE.MeshBasicMaterial({
          color: '#fbbf24',
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      )
      flatRing.rotation.x = Math.PI / 2
      group.add(flatRing)
    }
  }

  group.userData = { id: node.id }
  return group
}

// ─── Floating label ───────────────────────────────────────────────────────

function FollowingLabel({ node, variant }: { node: SceneNode | undefined; variant: 'hover' | 'select' | 'hub' }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current || !node) return
    groupRef.current.position.set(node.x ?? 0, (node.y ?? 0) + node._radius * 2.5 + 6, node.z ?? 0)
  })
  if (!node) return null
  const title = node.title.length > 56 ? node.title.slice(0, 53) + '…' : node.title
  const subtitle = node.repo ?? node.type
  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[100, 0]}>
        <div
          className="pointer-events-none whitespace-nowrap select-none"
          style={{
            padding: variant === 'hub' ? '2px 7px' : '4px 10px',
            borderRadius: '8px',
            background: variant === 'hub' ? 'rgba(8,4,18,0.55)' : variant === 'select' ? 'rgba(8,4,18,0.94)' : 'rgba(8,4,18,0.78)',
            border: `1px solid ${variant === 'select' ? node._hex : variant === 'hub' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.10)'}`,
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

// ─── Nebula field — sprite billboards if textures present, else low-poly fallback ─

const NEBULA_SEEDS: { pos: [number, number, number]; brush: 'nebula_violet' | 'nebula_cyan' | 'nebula_amber' | 'nebula_rose'; scale: number; opacity: number }[] = [
  { pos: [ 280,  120, -250], brush: 'nebula_violet', scale: 520, opacity: 0.6 },
  { pos: [-300,  -60, -300], brush: 'nebula_cyan',   scale: 580, opacity: 0.5 },
  { pos: [  60,  340, -180], brush: 'nebula_rose',   scale: 420, opacity: 0.45 },
  { pos: [   0,    0, -460], brush: 'nebula_amber',  scale: 700, opacity: 0.35 },
  { pos: [-180, -280, -220], brush: 'nebula_violet', scale: 380, opacity: 0.4 },
]

function NebulaField() {
  const bundle = useCortexTextures()
  if (!bundle.ready) return null
  return (
    <>
      {NEBULA_SEEDS.map((s, i) => {
        const tex = bundle.nebulae[s.brush]
        if (tex) {
          return (
            <sprite key={i} position={s.pos} scale={[s.scale, s.scale, 1]}>
              <spriteMaterial
                map={tex}
                transparent
                opacity={s.opacity}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
          )
        }
        const fallbackColor =
          s.brush === 'nebula_violet' ? '#7c3aed' :
          s.brush === 'nebula_cyan'   ? '#0ea5e9' :
          s.brush === 'nebula_amber'  ? '#f59e0b' : '#ec4899'
        return (
          <mesh key={i} position={s.pos}>
            <sphereGeometry args={[s.scale * 0.35, 12, 12]} />
            <meshBasicMaterial
              color={fallbackColor}
              transparent
              opacity={0.12}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )
      })}
    </>
  )
}

// ─── Spaceship sprite on a slow Bezier path ───────────────────────────────

function Spaceship() {
  const ref = useRef<THREE.Sprite>(null)
  const bundle = useCortexTextures()
  useFrame((state) => {
    if (!ref.current) return
    const t = (state.clock.elapsedTime * 0.05) % 1
    // Bezier-ish path that loops gently around the scene.
    const p0 = new THREE.Vector3(-420,  120, 300)
    const p1 = new THREE.Vector3(   0,  280, -200)
    const p2 = new THREE.Vector3( 420,  -60, 280)
    const p3 = new THREE.Vector3( 200, -240, -300)
    const a = lerp3(p0, p1, t)
    const b = lerp3(p1, p2, t)
    const c = lerp3(p2, p3, t)
    const d = lerp3(a, b, t)
    const e = lerp3(b, c, t)
    const f = lerp3(d, e, t)
    ref.current.position.copy(f)
  })
  if (!bundle.spaceship) return null
  return (
    <sprite ref={ref} scale={[35, 35, 1]}>
      <spriteMaterial map={bundle.spaceship} transparent opacity={0.95} toneMapped={false} depthWrite={false} />
    </sprite>
  )
}

function lerp3(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  )
}

// ─── Scene-data prep ──────────────────────────────────────────────────────

function buildSceneData(nodes: GraphNode[], edges: GraphEdge[], colorMode: ColorMode) {
  const now = Date.now()
  // Compute degree per node so we can promote the top hubs to always-on labels.
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
      _radius: n.pinned ? 6.0 : 3.4 + recency * 1.6,
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
