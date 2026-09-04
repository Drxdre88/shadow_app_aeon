// Card fusion effect: timing + geometry. Pure — FusionEffect.tsx drives its
// ghost cards AND its canvas (trails, shockwaves, particles) from these, so
// the two agree frame for frame and the choreography is testable without
// a browser.
//
// Choreography: every absorbed card lifts as a ghost and flies along an arc
// into the survivor, staggered so a big fusion fans in like a swarm; each
// arrival fires a shockwave + particle burst in that card's colour; after
// the last arrival the survivor breathes once and settles.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const FLIGHT_MS = 640
export const IMPACT_MS = 520
export const SETTLE_MS = 420
/** Gap between consecutive launches — shrinks for big fusions so the whole flight stays under MAX_STAGGER_MS. */
export const STAGGER_MS = 45
export const MAX_STAGGER_MS = 700

export function flightDelay(index: number, count: number): number {
  if (count <= 1 || index <= 0) return 0
  const step = Math.min(STAGGER_MS, MAX_STAGGER_MS / (count - 1))
  return Math.round(index * step)
}

export function arrivalTime(index: number, count: number): number {
  return flightDelay(index, count) + FLIGHT_MS
}

export function totalDuration(count: number): number {
  return arrivalTime(Math.max(0, count - 1), count) + IMPACT_MS + SETTLE_MS
}

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Control point of a ghost's arc: perpendicular to the straight flight,
 * bowed by a fraction of its length and alternating sides by index, so a
 * swarm of ghosts fans out instead of stacking on one line.
 */
export function arcControl(from: Point, to: Point, index: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(160, len * 0.28) * (index % 2 === 0 ? 1 : -1)
  return { x: (from.x + to.x) / 2 - (dy / len) * bow, y: (from.y + to.y) / 2 + (dx / len) * bow }
}

export function quadBezier(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

export interface GhostFrame {
  /** 0 before launch, 1 on arrival. */
  progress: number
  center: Point
  scale: number
  opacity: number
  rotate: number
  arrived: boolean
}

/** Where ghost `index` of `count` is at overlay time `t` (ms since the first frame). */
export function ghostFrame(from: Rect, to: Rect, index: number, count: number, t: number): GhostFrame {
  const local = clamp01((t - flightDelay(index, count)) / FLIGHT_MS)
  const e = easeInOutCubic(local)
  const a = center(from)
  const b = center(to)
  return {
    progress: local,
    center: quadBezier(a, arcControl(a, b, index), b, e),
    scale: 1 - 0.88 * e,
    opacity: local < 0.85 ? 1 : 1 - ((local - 0.85) / 0.15) * 0.4,
    rotate: Math.sin(e * Math.PI) * (index % 2 === 0 ? 6 : -6),
    arrived: local >= 1,
  }
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
}

export function spawnBurst(origin: Point, color: string, count: number, rand: () => number = Math.random): Particle[] {
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2
    const speed = 90 + rand() * 260
    const maxLife = 420 + rand() * 380
    out.push({ x: origin.x, y: origin.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: maxLife, maxLife, size: 1.5 + rand() * 2.5, color })
  }
  return out
}

/** Advance by `dtMs`, dropping the dead. Velocity decays so bursts bloom then hang. */
export function stepParticles(particles: readonly Particle[], dtMs: number): Particle[] {
  const dt = dtMs / 1000
  const out: Particle[] = []
  for (const p of particles) {
    const life = p.life - dtMs
    if (life <= 0) continue
    out.push({ ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt, vx: p.vx * 0.94, vy: p.vy * 0.94, life })
  }
  return out
}
