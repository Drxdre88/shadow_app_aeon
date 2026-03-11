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
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
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
