import type { GraphNode } from '@/lib/data/memories'

export type ColorMode = 'realm' | 'repo' | 'type' | 'source'

const REALM_HUES = [262, 200, 150, 32, 0, 320, 90, 220]

const SOURCE_HUE: Record<string, number> = {
  claude:    268,
  manual:    170,
  voice:     38,
  hook:      300,
}

const TYPE_HUE: Record<string, number> = {
  reflection:      348,
  decision:        200,
  fact:            60,
  note:            210,
  session_summary: 280,
  link:            140,
}

const EDGE_COLOR: Record<string, string> = {
  supports:        '#10b981',
  contradicts:     '#f43f5e',
  refers_to:       '#cbd5e1',
  relates:         '#38bdf8',
  supersedes:      '#a855f7',
  blocks_thinking: '#f59e0b',
  'auto-day':      '#475569',
  'auto-tag':      '#64748b',
  'auto-repo':     '#fbbf24',
}

function hashHue(key: string | null | undefined, palette: number[]): number {
  if (!key) return 240
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function nodeHue(node: GraphNode, mode: ColorMode = 'realm'): number {
  switch (mode) {
    case 'repo':
      return hashHue(node.repo, REALM_HUES)
    case 'type':
      return TYPE_HUE[node.type] ?? hashHue(node.type, REALM_HUES)
    case 'source':
      return SOURCE_HUE[node.source] ?? hashHue(node.source, REALM_HUES)
    case 'realm':
    default:
      if (node.realmId) return hashHue(node.realmId, REALM_HUES)
      // Fallback so realmId=null memories still get some signal.
      return TYPE_HUE[node.type] ?? SOURCE_HUE[node.source] ?? 240
  }
}

export function nodeColorHex(
  node: GraphNode,
  mode: ColorMode = 'realm',
  opts?: { lightness?: number; saturation?: number }
): string {
  const hue = nodeHue(node, mode)
  const s = opts?.saturation ?? 85
  const l = opts?.lightness ?? 60
  return `hsl(${hue}, ${s}%, ${l}%)`
}

export function edgeColor(type: string): string {
  return EDGE_COLOR[type] ?? '#64748b'
}

export function isAutoEdge(type: string): boolean {
  return type.startsWith('auto-')
}
