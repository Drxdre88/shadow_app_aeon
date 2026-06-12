'use client'

import { useMemo } from 'react'
import type {
  AetherPayload,
  AetherThought,
} from '@/lib/kairos/aether-types'

// ─── Hue mapping ──────────────────────────────────────────────────────────────
const DOMINION_COLOR_HUE: Record<string, number> = {
  purple: 270, violet: 290, sky: 210, blue: 220, cyan: 190, teal: 175,
  emerald: 150, green: 130, lime: 90, yellow: 55, amber: 40, orange: 25,
  red: 0, rose: 350, pink: 330, fuchsia: 310,
}
const HALO_PALETTE = [262, 200, 150, 32, 0, 320, 90, 220]

function hashHue(key: string | null | undefined): number {
  if (!key) return 240
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return HALO_PALETTE[h % HALO_PALETTE.length]
}

function thoughtHue(dominionColor: string | null, dominionId: string | null): number {
  if (dominionColor && dominionColor in DOMINION_COLOR_HUE) {
    return DOMINION_COLOR_HUE[dominionColor]
  }
  return hashHue(dominionId)
}

// Deterministic per-id seed in 0..1 — drives shimmer/pulse phase so orbs don't
// breathe in lockstep.
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h >>> 0) / 0xffffffff
}

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// ─── Layout item ──────────────────────────────────────────────────────────────
export interface ThoughtLayoutItem {
  thought: AetherThought
  hue: number
  radius: number
  glow: number
  seed: number
  position: [number, number, number]
}

const RELAX_ITERS = 70
const RELAX_MARGIN = 7 // clear gap between bubble surfaces

// Group by dominion, seed each cluster around a wide ring, then relax so no two
// bubbles interpenetrate. Spacing scales to each bubble's radius.
function computePositions(
  items: { id: string; r: number; salience: number; eureka: boolean }[],
  groups: Map<string | null, string[]>,
): Map<string, [number, number, number]> {
  const byId = new Map(items.map((i) => [i.id, i]))
  const nodes: { id: string; r: number; x: number; y: number; z: number }[] = []

  let groupIdx = 0
  for (const [, memberIds] of groups) {
    const rng = seededRng(groupIdx * 7919 + 1)
    const angle = (groupIdx / groups.size) * Math.PI * 2
    const groupR = 55 + rng() * 30
    const ax = Math.cos(angle) * groupR
    const az = Math.sin(angle) * groupR

    for (let i = 0; i < memberIds.length; i++) {
      const it = byId.get(memberIds[i])!
      const rng2 = seededRng(groupIdx * 997 + i * 311)
      const scatter = 16 + rng2() * 18
      const a2 = rng2() * Math.PI * 2
      let y = (rng2() - 0.5) * 30 + it.salience * 16
      let depthZ = -(1 - it.salience) * 32
      if (it.eureka) { y += 14; depthZ += 20 }
      nodes.push({
        id: it.id,
        r: it.r,
        x: ax + Math.cos(a2) * scatter,
        y,
        z: az + Math.sin(a2) * scatter + depthZ,
      })
    }
    groupIdx++
  }

  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const A = nodes[a]
        const B = nodes[b]
        let dx = B.x - A.x
        let dy = B.y - A.y
        let dz = B.z - A.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
        const min = A.r + B.r + RELAX_MARGIN
        if (d < min) {
          const push = ((min - d) / d) * 0.5
          dx *= push; dy *= push; dz *= push
          A.x -= dx; A.y -= dy; A.z -= dz
          B.x += dx; B.y += dy; B.z += dz
        }
      }
    }
  }

  const positions = new Map<string, [number, number, number]>()
  for (const n of nodes) positions.set(n.id, [n.x, n.y, n.z])
  return positions
}

// Stable visual + spatial layout for the thought field. Depends only on the
// payload's thoughts — independent of selection/hover, so positions never jump.
export function useThoughtLayout(payload: AetherPayload): {
  items: ThoughtLayoutItem[]
  positions: Map<string, [number, number, number]>
} {
  return useMemo(() => {
    const base = payload.thoughts.map((thought) => {
      const hue = thoughtHue(thought.dominionColor, thought.dominionId)
      const radius = 3 + thought.salience * 6.5
      const ageFade = Math.max(0, 1 - thought.ageDays / 30)
      const glow =
        thought.kind === 'eureka'
          ? Math.max(0.92, thought.salience)
          : thought.salience * 0.85 * ageFade
      return { thought, hue, radius, glow, seed: seedFromId(thought.id) }
    })

    const groups = new Map<string | null, string[]>()
    for (const b of base) {
      const key = b.thought.dominionId
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(b.thought.id)
    }

    const positions = computePositions(
      base.map((b) => ({
        id: b.thought.id,
        r: b.radius,
        salience: b.thought.salience,
        eureka: b.thought.kind === 'eureka',
      })),
      groups,
    )

    const items: ThoughtLayoutItem[] = base.map((b) => ({
      ...b,
      position: positions.get(b.thought.id) ?? [0, 0, 0],
    }))

    return { items, positions }
  }, [payload.thoughts])
}
