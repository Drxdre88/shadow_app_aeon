import * as THREE from 'three'
import type { SceneNode } from '../scene/PlanetCloud'
import { isAutoEdge, nodeHue, type ColorMode } from '../nodeColor'

// Pure buffer builders for the instanced galaxy. Everything here is plain
// typed-array maths so it can be unit-tested and timed without WebGL: the
// renderer creates a fixed number of draw objects (one InstancedMesh per orb
// material, one fat-line batch per edge style, one particle batch, one ring
// batch) no matter how many memories are loaded.

export type LinkLike = {
  // force-graph rewrites source/target into node objects once the sim starts.
  source: string | { id: string }
  target: string | { id: string }
  type: string
  _color: string
}

export type EdgeStyleKey = 'semantic' | 'auto' | 'supersedes' | 'tension'

// Widths mirror the old per-edge force-graph cylinders (world units).
export const EDGE_STYLES: Record<EdgeStyleKey, { width: number; curvature: number }> = {
  semantic:   { width: 2.8, curvature: 0 },
  auto:       { width: 1.0, curvature: 0 },
  supersedes: { width: 1.4, curvature: 0 },
  tension:    { width: 2.4, curvature: 0.35 },
}
export const EDGE_STYLE_ORDER: EdgeStyleKey[] = ['semantic', 'auto', 'supersedes', 'tension']
export const CURVE_SEGMENTS = 16
export const PARTICLE_SPEED = 0.006
export const RING_PARTICLES = 600
// Pick radius matches the old additive shell (1.18× the orb).
export const SHELL_SCALE = 1.18

export function edgeStyleKey(type: string): EdgeStyleKey {
  if (type === 'tension') return 'tension'
  if (type === 'supersedes') return 'supersedes'
  return isAutoEdge(type) ? 'auto' : 'semantic'
}

export function particlesForType(type: string): number {
  if (type === 'supports') return 4
  if (type === 'relates' || type === 'refers_to') return 2
  if (type === 'supersedes') return 3
  if (type === 'auto-repo') return 2
  if (type === 'auto-day') return 1
  return 0
}

export type EdgeBucket = {
  key: EdgeStyleKey
  width: number
  curvature: number
  segmentsPerEdge: number
  edgeCount: number
  src: Uint32Array
  dst: Uint32Array
  /** xyz,xyz per segment — rewritten every frame from node positions. */
  positions: Float32Array
  /** rgb,rgb per segment (linear). */
  colors: Float32Array
}

export type ParticleBuffers = {
  count: number
  src: Uint32Array
  dst: Uint32Array
  curvature: Float32Array
  /** Initial progress ratio (idx / particlesOnLink), as force-graph seeded it. */
  phase: Float32Array
  colors: Float32Array
}

export type RingBuffers = {
  ringCount: number
  count: number
  /** Node index owning each ring (length ringCount). */
  owners: Uint32Array
  /** angle0, orbit radius, y jitter, angular speed — per particle. */
  orbit: Float32Array
  scale: Float32Array
}

export type GalaxyBuffers = {
  nodeCount: number
  index: Map<string, number>
  radii: Float32Array
  edges: EdgeBucket[]
  particles: ParticleBuffers
  rings: RingBuffers
  /** Links whose endpoint is not in the node set (never drawn). */
  droppedEdges: number
}

const endpointId = (e: string | { id: string }) => (typeof e === 'string' ? e : e.id)

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

// Deterministic PRNG so ring debris is stable per memory (no Math.random in render).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Resolved = { s: number; t: number; key: EdgeStyleKey; color: THREE.Color; type: string }

export function buildGalaxyBuffers(nodes: SceneNode[], links: LinkLike[]): GalaxyBuffers {
  const n = nodes.length
  const index = new Map<string, number>()
  const radii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    index.set(nodes[i].id, i)
    radii[i] = nodes[i]._radius
  }

  const resolved: Resolved[] = []
  const counts: Record<EdgeStyleKey, number> = { semantic: 0, auto: 0, supersedes: 0, tension: 0 }
  const colorCache = new Map<string, THREE.Color>()
  let dropped = 0
  let particleCount = 0
  for (const l of links) {
    const s = index.get(endpointId(l.source))
    const t = index.get(endpointId(l.target))
    if (s === undefined || t === undefined) {
      dropped++
      continue
    }
    const key = edgeStyleKey(l.type)
    let color = colorCache.get(l._color)
    if (!color) {
      color = new THREE.Color(l._color)
      colorCache.set(l._color, color)
    }
    counts[key]++
    particleCount += particlesForType(l.type)
    resolved.push({ s, t, key, color, type: l.type })
  }

  const edges: EdgeBucket[] = []
  const byKey = new Map<EdgeStyleKey, EdgeBucket>()
  const cursor = new Map<EdgeStyleKey, number>()
  for (const key of EDGE_STYLE_ORDER) {
    if (counts[key] === 0) continue
    const { width, curvature } = EDGE_STYLES[key]
    const segmentsPerEdge = curvature ? CURVE_SEGMENTS : 1
    const segs = counts[key] * segmentsPerEdge
    const bucket: EdgeBucket = {
      key, width, curvature, segmentsPerEdge,
      edgeCount: counts[key],
      src: new Uint32Array(counts[key]),
      dst: new Uint32Array(counts[key]),
      positions: new Float32Array(segs * 6),
      colors: new Float32Array(segs * 6),
    }
    edges.push(bucket)
    byKey.set(key, bucket)
    cursor.set(key, 0)
  }

  const particles: ParticleBuffers = {
    count: particleCount,
    src: new Uint32Array(particleCount),
    dst: new Uint32Array(particleCount),
    curvature: new Float32Array(particleCount),
    phase: new Float32Array(particleCount),
    colors: new Float32Array(particleCount * 3),
  }
  let p = 0
  for (const e of resolved) {
    const b = byKey.get(e.key)!
    const k = cursor.get(e.key)!
    cursor.set(e.key, k + 1)
    b.src[k] = e.s
    b.dst[k] = e.t
    const base = k * b.segmentsPerEdge * 6
    for (let v = 0; v < b.segmentsPerEdge * 2; v++) {
      b.colors[base + v * 3] = e.color.r
      b.colors[base + v * 3 + 1] = e.color.g
      b.colors[base + v * 3 + 2] = e.color.b
    }
    const np = particlesForType(e.type)
    for (let j = 0; j < np; j++, p++) {
      particles.src[p] = e.s
      particles.dst[p] = e.t
      particles.curvature[p] = b.curvature
      particles.phase[p] = j / np
      particles.colors[p * 3] = e.color.r
      particles.colors[p * 3 + 1] = e.color.g
      particles.colors[p * 3 + 2] = e.color.b
    }
  }

  const owners: number[] = []
  for (let i = 0; i < n; i++) if (nodes[i].pinned) owners.push(i)
  const ringCount = owners.length
  const count = ringCount * RING_PARTICLES
  const orbit = new Float32Array(count * 4)
  const scale = new Float32Array(count)
  for (let r = 0; r < ringCount; r++) {
    const node = nodes[owners[r]]
    const rand = mulberry32(hash32(node.id))
    const inner = node._radius * 1.35
    const outer = node._radius * 2.1
    for (let j = 0; j < RING_PARTICLES; j++) {
      const q = r * RING_PARTICLES + j
      orbit[q * 4] = rand() * Math.PI * 2
      orbit[q * 4 + 1] = inner + Math.pow(rand(), 0.5) * (outer - inner)
      orbit[q * 4 + 2] = (rand() - 0.5) * 0.4
      orbit[q * 4 + 3] = 0.04 + rand() * 0.02
      scale[q] = 0.06 + rand() * 0.25
    }
  }

  return {
    nodeCount: n,
    index,
    radii,
    edges,
    particles,
    rings: { ringCount, count, owners: Uint32Array.from(owners), orbit, scale },
    droppedEdges: dropped,
  }
}

/** Number of THREE draw objects the galaxy renders for these buffers. */
export function drawObjectCount(b: GalaxyBuffers): number {
  const orbs = b.nodeCount > 0 ? 2 : 0 // orb body + additive shell
  return orbs + b.edges.length + (b.particles.count > 0 ? 1 : 0) + (b.rings.count > 0 ? 1 : 0)
}

/**
 * Per-instance orb tint + rim accent (linear RGB), identical maths to the old
 * per-planet uniforms: hsl from colorMode hue + glow; accent = hue+0.08,
 * sat×1.05, light×1.25 (capped at 0.85).
 */
export function writeNodeColors(nodes: SceneNode[], mode: ColorMode, tint: Float32Array, accent: Float32Array): void {
  const c = new THREE.Color()
  const hsl = { h: 0, s: 0, l: 0 }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    c.setStyle(`hsl(${nodeHue(n, mode)}, ${62 + 30 * n._glow}%, ${40 + 32 * n._glow}%)`)
    tint[i * 3] = c.r
    tint[i * 3 + 1] = c.g
    tint[i * 3 + 2] = c.b
    c.getHSL(hsl)
    c.setHSL((hsl.h + 0.08) % 1, Math.min(1, hsl.s * 1.05), Math.min(0.85, hsl.l * 1.25))
    accent[i * 3] = c.r
    accent[i * 3 + 1] = c.g
    accent[i * 3 + 2] = c.b
  }
}

export type Pos = { x?: number; y?: number; z?: number }

// Quadratic bezier matching three-forcegraph's calcLinkCurve (curveRotation 0):
// control = mid + (line·curvature) × Z (× Y when the line is parallel to Z).
function curvePoint(a: Pos, b: Pos, curvature: number, t: number, out: Float32Array, o: number): void {
  const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0
  const bx = b.x ?? 0, by = b.y ?? 0, bz = b.z ?? 0
  const lx = (bx - ax) * curvature, ly = (by - ay) * curvature, lz = (bz - az) * curvature
  let cx: number, cy: number, cz: number
  if (bx - ax !== 0 || by - ay !== 0) {
    cx = ly; cy = -lx; cz = 0
  } else {
    cx = -lz; cy = 0; cz = lx
  }
  cx += (ax + bx) / 2
  cy += (ay + by) / 2
  cz += (az + bz) / 2
  const u = 1 - t
  out[o] = u * u * ax + 2 * u * t * cx + t * t * bx
  out[o + 1] = u * u * ay + 2 * u * t * cy + t * t * by
  out[o + 2] = u * u * az + 2 * u * t * cz + t * t * bz
}

/** Rewrite a bucket's segment endpoints from the simulated node positions. */
export function writeEdgePositions(b: EdgeBucket, nodes: Pos[]): void {
  const out = b.positions
  if (b.segmentsPerEdge === 1) {
    for (let k = 0; k < b.edgeCount; k++) {
      const s = nodes[b.src[k]], t = nodes[b.dst[k]]
      const o = k * 6
      out[o] = s.x ?? 0; out[o + 1] = s.y ?? 0; out[o + 2] = s.z ?? 0
      out[o + 3] = t.x ?? 0; out[o + 4] = t.y ?? 0; out[o + 5] = t.z ?? 0
    }
    return
  }
  const segs = b.segmentsPerEdge
  for (let k = 0; k < b.edgeCount; k++) {
    const s = nodes[b.src[k]], t = nodes[b.dst[k]]
    for (let j = 0; j < segs; j++) {
      const o = (k * segs + j) * 6
      curvePoint(s, t, b.curvature, j / segs, out, o)
      curvePoint(s, t, b.curvature, (j + 1) / segs, out, o + 3)
    }
  }
}

/**
 * Write particle translations into an instanceMatrix array (16 floats each,
 * pre-filled with identity). Every particle advances PARTICLE_SPEED per frame
 * and wraps — force-graph's photon behaviour.
 */
export function writeParticleMatrices(pb: ParticleBuffers, nodes: Pos[], frame: number, matrices: Float32Array): void {
  const tmp = new Float32Array(3)
  const advance = frame * PARTICLE_SPEED
  for (let i = 0; i < pb.count; i++) {
    const s = nodes[pb.src[i]], t = nodes[pb.dst[i]]
    const r = (pb.phase[i] + advance) % 1
    const o = i * 16 + 12
    if (pb.curvature[i]) {
      curvePoint(s, t, pb.curvature[i], r, tmp, 0)
      matrices[o] = tmp[0]; matrices[o + 1] = tmp[1]; matrices[o + 2] = tmp[2]
    } else {
      const sx = s.x ?? 0, sy = s.y ?? 0, sz = s.z ?? 0
      matrices[o] = sx + ((t.x ?? 0) - sx) * r
      matrices[o + 1] = sy + ((t.y ?? 0) - sy) * r
      matrices[o + 2] = sz + ((t.z ?? 0) - sz) * r
    }
  }
}

/** Fill a matrix array with identity matrices (count × 16 floats). */
export function fillIdentity(matrices: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    const o = i * 16
    matrices.fill(0, o, o + 16)
    matrices[o] = 1; matrices[o + 5] = 1; matrices[o + 10] = 1; matrices[o + 15] = 1
  }
}

/** Write a uniform-scale + translation matrix (column-major) at instance i. */
export function writeScaleTranslate(m: Float32Array, i: number, s: number, x: number, y: number, z: number): void {
  const o = i * 16
  m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0
  m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0
  m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1
}
