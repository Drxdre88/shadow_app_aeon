import { resolveColor, type AccentColor } from '@/lib/utils/colors'
import type { ProjectWithStats } from './types'

export interface StarParticle {
  x: number; y: number; size: number; brightness: number
  twinkleSpeed: number; twinkleOffset: number; layer: number
  colorR: number; colorG: number; colorB: number
  isBright: boolean; isHero: boolean
}

export interface Nebula {
  x: number; y: number; rx: number; ry: number
  rotation: number; color: string; opacity: number
}

export interface PlanetOrb {
  id: string; name: string; group: string
  wx: number; wy: number; radius: number
  hex: string; glow: string
  completionPct: number; totalTasks: number; planetSrc: string
  orbitCx: number; orbitCy: number; orbitDist: number; orbitAngle: number
}


function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

const STAR_TINTS = [
  [220, 225, 245], [255, 240, 220], [200, 210, 255],
  [255, 220, 200], [180, 200, 255], [255, 255, 240],
  [240, 200, 180], [200, 240, 255],
]

export function generateStarfield(count: number): StarParticle[] {
  const rng = seededRng(42)
  return Array.from({ length: count }, () => {
    const roll = rng()
    const isHero = roll < 0.002
    const isBright = roll < 0.012
    const size = isHero ? 4.0 + rng() * 2.5
      : isBright ? 2.5 + rng() * 1.8
      : roll < 0.05 ? 1.4 + rng() * 1.0
      : roll < 0.18 ? 0.7 + rng() * 0.7
      : 0.15 + rng() * 0.5
    const tint = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)]
    return {
      x: (rng() - 0.5) * 8000,
      y: (rng() - 0.5) * 8000,
      size,
      brightness: isHero ? 0.92 + rng() * 0.08 : isBright ? 0.85 + rng() * 0.15 : 0.25 + rng() * 0.75,
      twinkleSpeed: isHero ? 0.15 + rng() * 0.4 : isBright ? 0.2 + rng() * 0.6 : 0.4 + rng() * 2.5,
      twinkleOffset: rng() * Math.PI * 2,
      layer: isHero ? 2 : rng() < 0.3 ? 0 : rng() < 0.7 ? 1 : 2,
      colorR: tint[0], colorG: tint[1], colorB: tint[2],
      isBright, isHero,
    }
  })
}

export function generateNebulas(): Nebula[] {
  const rng = seededRng(99)
  const colors = [
    'rgba(180, 120, 60, ALPHA)', 'rgba(60, 80, 180, ALPHA)',
    'rgba(140, 50, 130, ALPHA)', 'rgba(200, 150, 80, ALPHA)',
    'rgba(70, 110, 190, ALPHA)', 'rgba(120, 60, 150, ALPHA)',
    'rgba(50, 130, 120, ALPHA)', 'rgba(160, 80, 180, ALPHA)',
    'rgba(80, 160, 140, ALPHA)', 'rgba(200, 100, 60, ALPHA)',
  ]
  return Array.from({ length: 16 }, (_, i) => ({
    x: (rng() - 0.5) * 5000,
    y: (rng() - 0.5) * 5000,
    rx: 200 + rng() * 500,
    ry: 120 + rng() * 400,
    rotation: rng() * Math.PI,
    color: colors[Math.floor(rng() * colors.length)],
    opacity: i < 4 ? 0.06 + rng() * 0.06 : 0.03 + rng() * 0.05,
  }))
}


export function layoutPlanets(
  projects: ProjectWithStats[],
  projectColors: Record<string, string>,
): { planets: PlanetOrb[]; groups: Map<string, PlanetOrb[]> } {
  const groupMap = new Map<string, ProjectWithStats[]>()
  for (const p of projects) {
    const key = p.group || 'General'
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(p)
  }

  const groupNames = Array.from(groupMap.keys())
  const planets: PlanetOrb[] = []
  const planetGroups = new Map<string, PlanetOrb[]>()
  const cols = Math.max(1, Math.ceil(Math.sqrt(groupNames.length)))
  const spacing = 500

  groupNames.forEach((gName, gi) => {
    const col = gi % cols
    const row = Math.floor(gi / cols)
    const cx = (col - (cols - 1) / 2) * spacing
    const cy = (row - (Math.ceil(groupNames.length / cols) - 1) / 2) * spacing
    const members = groupMap.get(gName)!
    const groupPlanets: PlanetOrb[] = []
    const ringGap = 50
    const innerRing = 80

    members.forEach((p, pi) => {
      const angle = (pi / Math.max(members.length, 1)) * Math.PI * 2 - Math.PI / 2
      const dist = innerRing + pi * ringGap
      const colorKey = (projectColors[p.id] || 'purple') as AccentColor
      const resolved = resolveColor(colorKey)
      const planet: PlanetOrb = {
        id: p.id, name: p.name, group: gName,
        wx: cx + Math.cos(angle) * dist,
        wy: cy + Math.sin(angle) * dist,
        radius: Math.max(28, 24 + Math.sqrt(p.totalTasks + 1) * 4),
        hex: resolved.hex, glow: resolved.glow,
        completionPct: p.completionPct,
        totalTasks: p.totalTasks,
        planetSrc: `/planets/${p.planetImage || 'planet1.png'}`,
        orbitCx: cx, orbitCy: cy, orbitDist: dist, orbitAngle: angle,
      }
      planets.push(planet)
      groupPlanets.push(planet)
    })
    planetGroups.set(gName, groupPlanets)
  })

  return { planets, groups: planetGroups }
}

export const PARALLAX = [0.3, 0.6, 1.0]
