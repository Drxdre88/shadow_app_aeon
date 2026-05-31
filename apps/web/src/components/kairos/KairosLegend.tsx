'use client'

import { useMemo, useState } from 'react'
import type { GraphNode } from '@/lib/data/memories'
import { nodeColorHex, type ColorMode } from './nodeColor'
import { DominionEditDrawer } from './DominionEditDrawer'

type Props = {
  nodes: GraphNode[]
  mode: ColorMode
}

// Pull the distinct value for the current mode off each node, count it,
// then surface the top ~10 with their colour swatch. When mode='dominion',
// pills are clickable — they open the Dominion edit drawer (C13).
export function KairosLegend({ nodes, mode }: Props) {
  const items = useMemo(() => buildLegend(nodes, mode), [nodes, mode])
  const [drawerId, setDrawerId] = useState<string | null>(null)
  if (items.length === 0) return null

  return (
    <>
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col gap-1.5 max-w-[260px]">
        <div className="text-[9px] uppercase tracking-[0.22em] text-white/35 pl-1">
          Legend — {mode}
        </div>
        <div className="pointer-events-auto flex flex-col gap-1 p-2 rounded-xl bg-black/55 backdrop-blur-md border border-white/[0.07]">
          {items.map((it) => {
            const isDominion = mode === 'dominion' && it.dominionId
            return (
              <button
                key={it.key}
                onClick={isDominion ? () => setDrawerId(it.dominionId!) : undefined}
                disabled={!isDominion}
                className={`flex items-center gap-2 text-left rounded px-0.5 py-0.5 ${
                  isDominion ? 'hover:bg-white/[0.05] cursor-pointer' : 'cursor-default'
                }`}
                title={isDominion ? 'Edit Dominion' : undefined}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    background: it.color,
                    boxShadow: `0 0 10px ${it.color}`,
                  }}
                />
                <span className="text-[11px] text-white/80 truncate">{it.label}</span>
                <span className="text-[10px] text-white/30 ml-auto">{it.count}</span>
              </button>
            )
          })}
        </div>
      </div>
      <DominionEditDrawer dominionId={drawerId} onClose={() => setDrawerId(null)} />
    </>
  )
}

function buildLegend(nodes: GraphNode[], mode: ColorMode) {
  const counts = new Map<string, { label: string; sample: GraphNode; count: number; dominionId?: string }>()
  for (const n of nodes) {
    const key = keyForNode(n, mode)
    if (!key) continue
    const existing = counts.get(key.key)
    if (existing) existing.count++
    else counts.set(key.key, { label: key.label, sample: n, count: 1, dominionId: key.dominionId })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((c) => ({
      key: c.label,
      label: c.label,
      count: c.count,
      color: nodeColorHex(c.sample, mode, { lightness: 60, saturation: 88 }),
      dominionId: c.dominionId,
    }))
}

function keyForNode(n: GraphNode, mode: ColorMode): { key: string; label: string; dominionId?: string } | null {
  switch (mode) {
    case 'dominion':
      if (!n.dominionId) return { key: '__unassigned__', label: 'Unassigned' }
      return { key: n.dominionId, label: n.dominionName ?? '(unnamed)', dominionId: n.dominionId }
    case 'repo':
      return n.repo ? { key: n.repo, label: n.repo } : { key: '__none__', label: '(no repo)' }
    case 'type':
      return { key: n.type, label: n.type }
    case 'source':
      return { key: n.source, label: n.source }
    case 'realm':
    default:
      if (n.realmId) return { key: `realm:${n.realmId.slice(0, 8)}`, label: `realm ${n.realmId.slice(0, 8)}` }
      return { key: `unanchored:${n.type}`, label: `unanchored · ${n.type}` }
  }
}
