import { describe, expect, it } from 'vitest'
import type { SceneNode } from '../../scene/PlanetCloud'
import {
  buildGalaxyBuffers,
  CURVE_SEGMENTS,
  drawObjectCount,
  fillIdentity,
  PARTICLE_SPEED,
  particlesForType,
  RING_PARTICLES,
  writeEdgePositions,
  writeNodeColors,
  writeParticleMatrices,
  type LinkLike,
} from '../buffers'

const TYPES = ['supports', 'relates', 'refers_to', 'supersedes', 'tension', 'auto-day', 'auto-tag', 'auto-repo', 'contradicts']

function fixture(nodeCount: number, edgeRatio = 1.3) {
  const nodes: SceneNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `m${i}`,
    title: `memory ${i}`,
    aiTitle: null,
    type: i % 3 ? 'note' : 'decision',
    source: 'claude',
    realmId: null,
    projectId: null,
    taskId: null,
    repo: i % 2 ? 'aeon' : null,
    tags: [],
    pinned: i % 50 === 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    confidence: 0.8,
    supersededAt: null,
    supersededById: null,
    invalidAt: null,
    dominionId: null,
    dominionName: null,
    dominionColor: i % 4 ? 'teal' : null,
    _hex: '#888888',
    _glow: i % 7 ? 0.9 : 0.22,
    _radius: 4 + (i % 5),
    _hue: 240,
    _degree: 0,
    x: i,
    y: i * 2,
    z: -i,
  }))
  const edgeCount = Math.round(nodeCount * edgeRatio)
  const links: LinkLike[] = Array.from({ length: edgeCount }, (_, k) => ({
    source: `m${k % nodeCount}`,
    target: `m${(k * 7 + 1) % nodeCount}`,
    type: TYPES[k % TYPES.length],
    _color: '#38bdf8',
  }))
  return { nodes, links }
}

function time(fn: () => void, runs = 5): number {
  fn() // warm JIT
  const samples: number[] = []
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

describe('galaxy buffers', () => {
  const sizes = [300, 1000, 3000]
  const drawCounts: number[] = []

  for (const n of sizes) {
    it(`builds constant draw objects at ${n} nodes`, () => {
      const { nodes, links } = fixture(n)
      const b = buildGalaxyBuffers(nodes, links)

      expect(b.nodeCount).toBe(n)
      expect(b.droppedEdges).toBe(0)
      const drawn = b.edges.reduce((s, e) => s + e.edgeCount, 0)
      expect(drawn).toBe(links.length)
      for (const e of b.edges) {
        expect(e.positions.length).toBe(e.edgeCount * e.segmentsPerEdge * 6)
        expect(e.colors.length).toBe(e.positions.length)
        expect(e.segmentsPerEdge).toBe(e.key === 'tension' ? CURVE_SEGMENTS : 1)
      }
      const expectedParticles = links.reduce((s, l) => s + particlesForType(l.type), 0)
      expect(b.particles.count).toBe(expectedParticles)
      const pinned = nodes.filter((x) => x.pinned).length
      expect(b.rings.count).toBe(pinned * RING_PARTICLES)

      // 2 orb meshes + 4 edge buckets + 1 particle batch + 1 ring batch.
      expect(drawObjectCount(b)).toBe(8)
      drawCounts.push(drawObjectCount(b))

      const buildMs = time(() => buildGalaxyBuffers(nodes, links))
      const tint = new Float32Array(n * 3)
      const accent = new Float32Array(n * 3)
      const colorMs = time(() => writeNodeColors(nodes, 'dominion', tint, accent))
      const mats = new Float32Array(b.particles.count * 16)
      fillIdentity(mats, b.particles.count)
      const frameMs = time(() => {
        for (const e of b.edges) writeEdgePositions(e, nodes)
        writeParticleMatrices(b.particles, nodes, 10, mats)
      })
      const before = n * 2 + links.length + expectedParticles + pinned
      console.info(
        `[galaxy] n=${n} edges=${links.length} particles=${b.particles.count} ` +
          `build=${buildMs.toFixed(2)}ms colors=${colorMs.toFixed(2)}ms perFrameEdges+particles=${frameMs.toFixed(2)}ms ` +
          `drawObjects after=${drawObjectCount(b)} before≈${before}`,
      )
      expect(buildMs).toBeLessThan(500)
    })
  }

  it('draw-object count does not grow with node count', () => {
    expect(new Set(drawCounts).size).toBe(1)
  })

  it('drops edges whose endpoint is not loaded and resolves object endpoints', () => {
    const { nodes } = fixture(3)
    const b = buildGalaxyBuffers(nodes, [
      { source: 'm0', target: 'missing', type: 'relates', _color: '#fff' },
      { source: { id: 'm0' }, target: { id: 'm2' }, type: 'relates', _color: '#fff' },
    ])
    expect(b.droppedEdges).toBe(1)
    expect(b.edges).toHaveLength(1)
    expect(Array.from(b.edges[0].src)).toEqual([0])
    expect(Array.from(b.edges[0].dst)).toEqual([2])
    expect(drawObjectCount(buildGalaxyBuffers([], []))).toBe(0)
  })

  it('writes exact straight-edge endpoints and curved tension endpoints', () => {
    const { nodes } = fixture(3)
    const b = buildGalaxyBuffers(nodes, [
      { source: 'm1', target: 'm2', type: 'supports', _color: '#10b981' },
      { source: 'm0', target: 'm2', type: 'tension', _color: '#f43f5e' },
    ])
    const straight = b.edges.find((e) => e.key === 'semantic')!
    writeEdgePositions(straight, nodes)
    expect(Array.from(straight.positions)).toEqual([1, 2, -1, 2, 4, -2])

    const arc = b.edges.find((e) => e.key === 'tension')!
    writeEdgePositions(arc, nodes)
    const p = arc.positions
    // Starts at m0, ends at m2, and bows off the chord at the midpoint.
    const close = (got: ArrayLike<number>, want: number[]) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w))
    close(p.slice(0, 3), [0, 0, 0])
    close(p.slice(p.length - 3), [2, 4, -2])
    const mid = (CURVE_SEGMENTS / 2) * 6
    expect(p[mid]).not.toBeCloseTo(1)
  })

  it('advances particles along the edge and wraps', () => {
    const { nodes } = fixture(3)
    const b = buildGalaxyBuffers(nodes, [{ source: 'm1', target: 'm2', type: 'auto-day', _color: '#475569' }])
    expect(b.particles.count).toBe(1)
    const m = new Float32Array(16)
    fillIdentity(m, 1)
    const frames = Math.round(0.5 / PARTICLE_SPEED)
    writeParticleMatrices(b.particles, nodes, frames, m)
    const r = (frames * PARTICLE_SPEED) % 1
    expect(m[12]).toBeCloseTo(1 + r)
    expect(m[13]).toBeCloseTo(2 + 2 * r)
    expect(m[15]).toBe(1)
  })

  it('keeps ghost orbs dimmer than confident ones and colours by mode', () => {
    const { nodes } = fixture(8)
    const tint = new Float32Array(24)
    const accent = new Float32Array(24)
    writeNodeColors(nodes, 'dominion', tint, accent)
    const lum = (i: number) => tint[i * 3] + tint[i * 3 + 1] + tint[i * 3 + 2]
    expect(lum(0)).toBeLessThan(lum(1)) // node 0 is ghost-glow 0.22
    expect(accent.some((v) => v > 0)).toBe(true)
  })
})
