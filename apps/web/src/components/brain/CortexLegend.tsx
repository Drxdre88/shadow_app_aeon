'use client'

import { useMemo } from 'react'
import type { GraphNode } from '@/lib/data/memories'
import { nodeColorHex, type ColorMode } from './nodeColor'

type Props = {
  nodes: GraphNode[]
  mode: ColorMode
}

// Pull the distinct value for the current mode off each node, count it,
// then surface the top ~10 with their colour swatch.
export function CortexLegend({ nodes, mode }: Props) {
  const items = useMemo(() => buildLegend(nodes, mode), [nodes, mode])
  if (items.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col gap-1.5 max-w-[260px]">
      <div className="text-[9px] uppercase tracking-[0.22em] text-white/35 pl-1">
        Legend — {mode}
      </div>
      <div className="pointer-events-auto flex flex-col gap-1 p-2 rounded-xl bg-black/55 backdrop-blur-md border border-white/[0.07]">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                background: it.color,
                boxShadow: `0 0 10px ${it.color}`,
              }}
            />
            <span className="text-[11px] text-white/80 truncate">{it.label}</span>
            <span className="text-[10px] text-white/30 ml-auto">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildLegend(nodes: GraphNode[], mode: ColorMode) {
  const counts = new Map<string, { label: string; sample: GraphNode; count: number }>()
  for (const n of nodes) {
    const key = keyForNode(n, mode)
    if (!key) continue
    const existing = counts.get(key.key)
    if (existing) existing.count++
    else counts.set(key.key, { label: key.label, sample: n, count: 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((c) => ({
      key: c.label,
      label: c.label,
      count: c.count,
      color: nodeColorHex(c.sample, mode, { lightness: 60, saturation: 88 }),
    }))
}

function keyForNode(n: GraphNode, mode: ColorMode): { key: string; label: string } | null {
  switch (mode) {
    case 'repo':
      return n.repo ? { key: n.repo, label: n.repo } : { key: '__none__', label: '(no repo)' }
    case 'type':
      return { key: n.type, label: n.type }
    case 'source':
      return { key: n.source, label: n.source }
    case 'realm':
    default:
      // Realm has no name in GraphNode — fall back to the user-facing label
      // we'd have used for hue. Group by realmId / type / source bucket.
      if (n.realmId) return { key: `realm:${n.realmId.slice(0, 8)}`, label: `realm ${n.realmId.slice(0, 8)}` }
      return { key: `unanchored:${n.type}`, label: `unanchored · ${n.type}` }
  }
}
