import type { GraphNode } from '@/lib/data/memories'

export type ColorMode = 'dominion' | 'realm' | 'repo' | 'type' | 'source'

const REALM_HUES = [262, 200, 150, 32, 0, 320, 90, 220]

const DOMINION_COLOR_HUE: Record<string, number> = {
  purple:  270,
  violet:  290,
  sky:     210,
  blue:    220,
  cyan:    190,
  teal:    175,
  emerald: 150,
  green:   130,
  lime:    90,
  yellow:  55,
  amber:   40,
  orange:  25,
  red:     0,
  rose:    350,
  pink:    330,
  fuchsia: 310,
}

const SOURCE_HUE: Record<string, number> = {
  claude:    268,
  manual:    170,
  voice:     38,
  hook:      300,
}

const TYPE_HUE: Record<string, number> = {
  reflection:      348,
  decision:        200,
  note:            210,
  session_summary: 280,
}

const EDGE_COLOR: Record<string, string> = {
  supports:         '#10b981',
  contradicts:      '#f43f5e',
  refers_to:        '#cbd5e1',
  relates:          '#38bdf8',
  supersedes:       '#a855f7',
  blocks_thinking:  '#f59e0b',
  'auto-day':       '#475569',
  'auto-tag':       '#64748b',
  'auto-repo':      '#fbbf24',
  'auto-dominion':  'hsla(45, 70%, 65%, 1)',
}

function hashHue(key: string | null | undefined, palette: number[]): number {
  if (!key) return 240
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function nodeHue(node: GraphNode, mode: ColorMode = 'dominion'): number {
  switch (mode) {
    case 'dominion':
      if (node.dominionColor && node.dominionColor in DOMINION_COLOR_HUE) {
        return DOMINION_COLOR_HUE[node.dominionColor]
      }
      return 220
    case 'repo':
      return hashHue(node.repo, REALM_HUES)
    case 'type':
      return TYPE_HUE[node.type] ?? hashHue(node.type, REALM_HUES)
    case 'source':
      return SOURCE_HUE[node.source] ?? hashHue(node.source, REALM_HUES)
    case 'realm':
    default:
      if (node.realmId) return hashHue(node.realmId, REALM_HUES)
      return TYPE_HUE[node.type] ?? SOURCE_HUE[node.source] ?? 240
  }
}

export function nodeColorHex(
  node: GraphNode,
  mode: ColorMode = 'dominion',
  opts?: { lightness?: number; saturation?: number }
): string {
  const hue = nodeHue(node, mode)
  const isUnassigned = mode === 'dominion' && !node.dominionColor
  const s = opts?.saturation ?? (isUnassigned ? 18 : 85)
  const l = opts?.lightness ?? 60
  return `hsl(${hue}, ${s}%, ${l}%)`
}

export function edgeColor(type: string): string {
  return EDGE_COLOR[type] ?? '#64748b'
}

export function isAutoEdge(type: string): boolean {
  return type.startsWith('auto-')
}

// Display-only title cleanup. The real semantic naming layer is Track C's
// AI auto-titling pass — until that lands, strip the worst formatting noise
// from raw session-capture titles (repo prefixes, XML tags, file paths) and
// cap length so the label reads as 1–6 words instead of a wall of slug text.
export function cleanTitle(raw: string): string {
  if (!raw) return ''
  let t = raw
  // "shadow_app_swarm: …" / "aeon_app: …" style prefixes
  t = t.replace(/^[a-z][\w-]*(?:_[\w-]+)+\s*[:>]\s*/i, '')
  // XML-like tags from system reminders / command stdout
  t = t.replace(/<\/?[a-z][\w-]*[^>]*>/gi, ' ')
  // Windows + unix paths
  t = t.replace(/[a-z]:\\[\\\w. -]+/gi, '')
  t = t.replace(/(?:^|\s)\/(?:[\w. -]+\/)+[\w. -]*/g, ' ')
  // Surrounding punctuation / quotes
  t = t.replace(/^["'`<>:\s]+|["'`<>:\s]+$/g, '')
  // Collapse whitespace
  t = t.trim().replace(/\s+/g, ' ')
  if (!t || t.length < 3) return raw.slice(0, 40)
  // Cap at 6 words.
  const words = t.split(/\s+/)
  if (words.length > 6) return words.slice(0, 6).join(' ') + '…'
  return t
}
