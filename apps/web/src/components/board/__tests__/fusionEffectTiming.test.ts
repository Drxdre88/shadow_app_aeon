import { describe, it, expect } from 'vitest'
import {
  FLIGHT_MS,
  IMPACT_MS,
  MAX_STAGGER_MS,
  SETTLE_MS,
  STAGGER_MS,
  arcControl,
  arrivalTime,
  center,
  flightDelay,
  ghostFrame,
  quadBezier,
  spawnBurst,
  stepParticles,
  totalDuration,
} from '../fusionEffectTiming'

// The fusion choreography, frame-exact: launches stagger but stay bounded,
// every ghost starts on its own card and lands dead-centre on the survivor,
// arcs fan out to alternate sides, bursts spawn where the survivor is and
// die on schedule.

const from = { x: 100, y: 100, width: 200, height: 120 }
const to = { x: 800, y: 500, width: 200, height: 120 }

describe('stagger', () => {
  it('launches the first ghost at once, then STAGGER_MS apart for small fusions', () => {
    expect(flightDelay(0, 1)).toBe(0)
    expect(flightDelay(0, 5)).toBe(0)
    expect(flightDelay(1, 5)).toBe(STAGGER_MS)
    expect(flightDelay(4, 5)).toBe(4 * STAGGER_MS)
  })

  it('compresses the stagger so a huge fusion still launches its last ghost within MAX_STAGGER_MS', () => {
    expect(flightDelay(99, 100)).toBeLessThanOrEqual(MAX_STAGGER_MS)
    expect(flightDelay(99, 100)).toBeGreaterThan(flightDelay(50, 100))
    expect(totalDuration(100)).toBe(MAX_STAGGER_MS + FLIGHT_MS + IMPACT_MS + SETTLE_MS)
  })

  it('total = last arrival + impact + settle', () => {
    expect(totalDuration(1)).toBe(FLIGHT_MS + IMPACT_MS + SETTLE_MS)
    expect(arrivalTime(2, 3)).toBe(2 * STAGGER_MS + FLIGHT_MS)
    expect(totalDuration(3)).toBe(arrivalTime(2, 3) + IMPACT_MS + SETTLE_MS)
  })
})

describe('ghostFrame', () => {
  it('sits on its own card, full size, before its launch', () => {
    const f = ghostFrame(from, to, 1, 3, 10)
    expect(f.progress).toBe(0)
    expect(f.center).toEqual(center(from))
    expect(f.scale).toBe(1)
    expect(f.opacity).toBe(1)
    expect(f.arrived).toBe(false)
  })

  it('lands dead-centre on the survivor, shrunk, on arrival — and stays there', () => {
    const at = ghostFrame(from, to, 1, 3, arrivalTime(1, 3))
    expect(at.arrived).toBe(true)
    expect(at.center.x).toBeCloseTo(center(to).x, 6)
    expect(at.center.y).toBeCloseTo(center(to).y, 6)
    expect(at.scale).toBeCloseTo(0.12, 6)
    const later = ghostFrame(from, to, 1, 3, arrivalTime(1, 3) + 500)
    expect(later.center).toEqual(at.center)
  })

  it('bows off the straight line mid-flight, to alternating sides by index', () => {
    const a = center(from)
    const b = center(to)
    const mid0 = ghostFrame(from, to, 0, 2, FLIGHT_MS / 2).center
    const mid1 = ghostFrame(from, to, 1, 2, STAGGER_MS + FLIGHT_MS / 2).center
    const side = (p: { x: number; y: number }) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    expect(side(mid0)).not.toBe(0)
    expect(side(mid1)).toBe(-side(mid0))
    expect(Math.hypot(mid0.x - mid1.x, mid0.y - mid1.y)).toBeGreaterThan(50)
  })

  it('a source measured AT the survivor never leaves it and still arrives', () => {
    const f = ghostFrame(to, to, 0, 1, FLIGHT_MS / 3)
    expect(f.center).toEqual(center(to))
    expect(ghostFrame(to, to, 0, 1, FLIGHT_MS).arrived).toBe(true)
  })
})

describe('geometry', () => {
  it('quadBezier hits both endpoints and the control pulls the middle', () => {
    const p0 = { x: 0, y: 0 }
    const p1 = { x: 10, y: 0 }
    const c = { x: 5, y: 10 }
    expect(quadBezier(p0, c, p1, 0)).toEqual(p0)
    expect(quadBezier(p0, c, p1, 1)).toEqual(p1)
    expect(quadBezier(p0, c, p1, 0.5).y).toBe(5)
  })

  it('arcControl caps the bow on long flights', () => {
    const c = arcControl({ x: 0, y: 0 }, { x: 4000, y: 0 }, 0)
    expect(Math.abs(c.y)).toBe(160)
    expect(c.x).toBe(2000)
  })
})

describe('particles', () => {
  it('spawns every particle at the origin with the burst colour', () => {
    const burst = spawnBurst({ x: 3, y: 4 }, '#ff00ff', 12, () => 0.5)
    expect(burst).toHaveLength(12)
    expect(burst.every((p) => p.x === 3 && p.y === 4 && p.color === '#ff00ff' && p.life === p.maxLife)).toBe(true)
  })

  it('moves particles, decays their speed, and drops them when their life runs out', () => {
    const [p] = spawnBurst({ x: 0, y: 0 }, '#fff', 1, () => 0)
    const next = stepParticles([p], 100)
    expect(next).toHaveLength(1)
    expect(next[0].x).toBeCloseTo(p.vx * 0.1, 6)
    expect(Math.abs(next[0].vx)).toBeLessThan(Math.abs(p.vx))
    expect(stepParticles([p], p.maxLife)).toHaveLength(0)
  })
})
