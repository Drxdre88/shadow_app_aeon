export type AccentColor = 'purple' | 'blue' | 'cyan' | 'green' | 'pink' | 'orange' | 'red' | 'none'
export type GlowIntensity = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

export const colorConfig = {
  purple: {
    bg: 'bg-purple-500/20',
    bgSolid: 'bg-purple-500',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
    ring: 'ring-purple-500/50',
    glow: 'rgba(168, 85, 247, 0.6)',
    glowDark: 'rgba(168, 85, 247, 0.4)',
    hex: '#a855f7',
  },
  blue: {
    bg: 'bg-blue-500/20',
    bgSolid: 'bg-blue-500',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    ring: 'ring-blue-500/50',
    glow: 'rgba(59, 130, 246, 0.6)',
    glowDark: 'rgba(59, 130, 246, 0.4)',
    hex: '#3b82f6',
  },
  cyan: {
    bg: 'bg-cyan-500/20',
    bgSolid: 'bg-cyan-500',
    border: 'border-cyan-500/30',
    text: 'text-cyan-400',
    ring: 'ring-cyan-500/50',
    glow: 'rgba(34, 211, 238, 0.6)',
    glowDark: 'rgba(34, 211, 238, 0.4)',
    hex: '#22d3ee',
  },
  green: {
    bg: 'bg-emerald-500/20',
    bgSolid: 'bg-emerald-500',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/50',
    glow: 'rgba(16, 185, 129, 0.6)',
    glowDark: 'rgba(16, 185, 129, 0.4)',
    hex: '#10b981',
  },
  pink: {
    bg: 'bg-pink-500/20',
    bgSolid: 'bg-pink-500',
    border: 'border-pink-500/30',
    text: 'text-pink-400',
    ring: 'ring-pink-500/50',
    glow: 'rgba(236, 72, 153, 0.6)',
    glowDark: 'rgba(236, 72, 153, 0.4)',
    hex: '#ec4899',
  },
  orange: {
    bg: 'bg-orange-500/20',
    bgSolid: 'bg-orange-500',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    ring: 'ring-orange-500/50',
    glow: 'rgba(249, 115, 22, 0.6)',
    glowDark: 'rgba(249, 115, 22, 0.4)',
    hex: '#f97316',
  },
  red: {
    bg: 'bg-red-500/20',
    bgSolid: 'bg-red-500',
    border: 'border-red-500/30',
    text: 'text-red-400',
    ring: 'ring-red-500/50',
    glow: 'rgba(239, 68, 68, 0.6)',
    glowDark: 'rgba(239, 68, 68, 0.4)',
    hex: '#ef4444',
  },
  none: {
    bg: 'bg-white/5',
    bgSolid: 'bg-slate-500',
    border: 'border-white/10',
    text: 'text-slate-400',
    ring: 'ring-slate-500/50',
    glow: 'rgba(255, 255, 255, 0.3)',
    glowDark: 'rgba(255, 255, 255, 0.2)',
    hex: '#94a3b8',
  },
}

export const glowIntensity = {
  none: { blur: 0, spread: 0, opacity: 0 },
  sm: { blur: 10, spread: 2, opacity: 0.3 },
  md: { blur: 20, spread: 5, opacity: 0.5 },
  lg: { blur: 30, spread: 10, opacity: 0.6 },
  xl: { blur: 40, spread: 15, opacity: 0.7 },
  xxl: { blur: 60, spread: 20, opacity: 0.8 },
}

export const ACCENT_COLORS: AccentColor[] = ['purple', 'blue', 'cyan', 'green', 'pink', 'orange', 'red']

/**
 * One accent value -> a concrete hex. Accepts either a preset accent name
 * (`'purple'`) or an already-literal `#rrggbb`; anything unknown or missing
 * falls back (purple unless the caller supplies its own fallback).
 *
 * Canonical: every avatar / dot / pill that needs "the hex behind this accent"
 * goes through here rather than re-inlining the colorConfig lookup.
 */
export function resolveAccentHex(
  color: string | null | undefined,
  fallback: string = colorConfig.purple.hex,
): string {
  if (!color) return fallback
  if (color.startsWith('#')) return color
  return (colorConfig[color as AccentColor] as { hex: string } | undefined)?.hex ?? fallback
}

export function hexToAccent(color: string): AccentColor {
  if (!color.startsWith('#')) return (color in colorConfig ? color : 'purple') as AccentColor
  const hex = color.toLowerCase()
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  let best: AccentColor = 'purple'
  let bestDist = Infinity
  for (const name of ACCENT_COLORS) {
    const h = colorConfig[name].hex
    const dr = r - parseInt(h.slice(1, 3), 16)
    const dg = g - parseInt(h.slice(3, 5), 16)
    const db = b - parseInt(h.slice(5, 7), 16)
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) { bestDist = dist; best = name }
  }
  return best
}

export const PALETTE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#fb7185', '#fda4af', '#fdba74', '#fcd34d',
  '#bef264', '#86efac', '#5eead4', '#67e8f9', '#93c5fd', '#a5b4fc', '#c4b5fd',
  '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#f1f5f9',
]

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length < 6) return `rgba(148, 163, 184, ${alpha})`
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(148, 163, 184, ${alpha})`
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface ResolvedColor {
  glow: string
  glowDark: string
  hex: string
  borderStyle: React.CSSProperties
  bgStyle: React.CSSProperties
  bgSolidStyle: React.CSSProperties
  textStyle: React.CSSProperties
  accentGradient: string
  isPreset: boolean
  presetKey?: AccentColor
}

const RECENT_COLORS_KEY = 'aeon-recent-colors'
const MAX_RECENT = 7

export function getRecentColors(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]')
  } catch { return [] }
}

export function addRecentColor(hex: string) {
  if (typeof window === 'undefined') return
  const presetHexes = ACCENT_COLORS.map(c => colorConfig[c].hex)
  if (presetHexes.includes(hex) || PALETTE_COLORS.includes(hex)) return
  const recent = getRecentColors().filter(c => c !== hex)
  recent.unshift(hex)
  if (recent.length > MAX_RECENT) recent.pop()
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent))
}

export function pickUniqueColor(usedColors: string[]): string {
  const normalize = (c: string) => c.toLowerCase().replace('#', '')
  const used = new Set(usedColors.map(normalize))
  const allPresetHexes = ACCENT_COLORS.filter(c => c !== 'none').map(c => colorConfig[c].hex)
  const candidates = [...allPresetHexes, ...PALETTE_COLORS]
  const available = candidates.filter(c => !used.has(normalize(c)))
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]
  }
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`
}

export function resolveColor(color: string): ResolvedColor {
  const preset = colorConfig[color as AccentColor]
  if (preset && color !== 'none') {
    return {
      glow: preset.glow,
      glowDark: preset.glowDark,
      hex: preset.hex,
      borderStyle: {},
      bgStyle: {},
      bgSolidStyle: {},
      textStyle: {},
      accentGradient: preset.glow.replace('0.6', '0.15'),
      isPreset: true,
      presetKey: color as AccentColor,
    }
  }

  const hex = color.startsWith('#') ? color : `#${color}`
  return {
    glow: hexToRgba(hex, 0.6),
    glowDark: hexToRgba(hex, 0.4),
    hex,
    borderStyle: { borderColor: hexToRgba(hex, 0.3) },
    bgStyle: { backgroundColor: hexToRgba(hex, 0.2) },
    bgSolidStyle: { backgroundColor: hex },
    textStyle: { color: hex },
    accentGradient: hexToRgba(hex, 0.15),
    isPreset: false,
  }
}
