'use client'

import { Html } from '@react-three/drei'
import type { ThoughtLayoutItem } from '../useThoughtLayout'
import { useAetherUi } from '../useAetherUi'

// Names an orb ONLY on hover/select — the field stays clean and labels on
// demand. Titles are clipped to a few words so they read as tags, never
// sentences (keeps the scene uncluttered even if a title runs long).
function tag(title: string): string {
  const words = title.trim().split(/\s+/)
  return words.length <= 3 ? title : words.slice(0, 3).join(' ')
}

export function ThoughtLabels({ items }: { items: ThoughtLayoutItem[] }) {
  const selectedId = useAetherUi((s) => s.selectedId)
  const hoveredId = useAetherUi((s) => s.hoveredId)

  return (
    <>
      {items.map((it) => {
        const active = it.thought.id === selectedId || it.thought.id === hoveredId
        if (!active) return null

        const [x, y, z] = it.position
        return (
          <Html
            key={it.thought.id}
            position={[x, y + it.radius + 4, z]}
            center
            distanceFactor={150}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            <div
              style={{
                transform: 'translateY(-50%)',
                whiteSpace: 'nowrap',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.02em',
                color: 'rgba(245,240,255,0.98)',
                textShadow: '0 0 8px rgba(120,80,255,0.55), 0 1px 2px rgba(0,0,0,0.85)',
              }}
            >
              {tag(it.thought.title)}
            </div>
          </Html>
        )
      })}
    </>
  )
}
