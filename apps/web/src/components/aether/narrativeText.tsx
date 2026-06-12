'use client'

import type { ReactNode, CSSProperties } from 'react'

const STOP = new Set([
  'the', 'this', 'that', 'these', 'those', 'it', 'a', 'an', 'and', 'but', 'or',
  'your', 'you', 'his', 'her', 'their', 'they', 'we', 'i', 'in', 'on', 'of',
  'to', 'is', 'are', 'as', 'at', 'by', 'for', 'with', 'while', 'when', 'where',
])

const STRONG: CSSProperties = {
  color: 'var(--accent, #c084fc)',
  fontWeight: 700,
  textShadow: '0 0 10px var(--glow-color, rgba(139,92,246,0.5))',
}

// Bold known entities (Dominion names) + interior proper nouns; leave common
// sentence-starting words plain so it highlights signal, not noise.
export function highlight(text: string, entities: string[]): ReactNode[] {
  const escaped = entities
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const proper = '[A-Z][a-zA-Z0-9]+(?:\\s+[A-Z][a-zA-Z0-9]+)*'
  const re = new RegExp(`(${[...escaped, proper].join('|')})`, 'g')

  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tok = m[0]
    if (m.index > last) out.push(text.slice(last, m.index))
    const isEntity = entities.some((e) => e.toLowerCase() === tok.toLowerCase())
    const single = !tok.includes(' ')
    if (!isEntity && single && STOP.has(tok.toLowerCase())) {
      out.push(tok)
    } else {
      out.push(<strong key={key++} style={STRONG}>{tok}</strong>)
    }
    last = m.index + tok.length
    if (re.lastIndex === m.index) re.lastIndex++
  }
  out.push(text.slice(last))
  return out
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
}

export function Bullet({
  children,
  dim,
  size = 12.5,
}: {
  children: ReactNode
  dim?: boolean
  size?: number
}) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span
        style={{
          marginTop: size * 0.5,
          width: 5,
          height: 5,
          borderRadius: '50%',
          flexShrink: 0,
          background: dim ? 'var(--primary-muted, rgba(139,92,246,0.4))' : 'var(--primary, #8b5cf6)',
          boxShadow: dim ? 'none' : '0 0 8px var(--glow-color, rgba(139,92,246,0.6))',
        }}
      />
      <span style={{ fontSize: dim ? size - 1.5 : size, lineHeight: 1.6, color: dim ? 'rgba(200,190,235,0.62)' : 'rgba(232,224,255,0.9)' }}>
        {children}
      </span>
    </li>
  )
}

export function entityList(thoughts: { dominionName: string | null }[]): string[] {
  const set = new Set<string>()
  for (const t of thoughts) if (t.dominionName) set.add(t.dominionName)
  return [...set]
}
