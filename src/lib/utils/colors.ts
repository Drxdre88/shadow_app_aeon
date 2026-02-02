export type AccentColor = 'purple' | 'blue' | 'cyan' | 'green' | 'pink' | 'orange' | 'none'
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

export function getGlowStyle(color: AccentColor, intensity: GlowIntensity, globalMultiplier: number = 75) {
  if (intensity === 'none' || globalMultiplier === 0) return {}
  const c = colorConfig[color]
  const i = glowIntensity[intensity]
  const mult = globalMultiplier / 75
  return {
    boxShadow: `0 0 ${i.blur * mult}px ${i.spread * mult}px ${c.glow}`,
    opacity: i.opacity * mult,
  }
}

export function applyGlowMultiplier(baseBlur: number, baseSpread: number, globalIntensity: number = 75) {
  const mult = globalIntensity / 75
  return {
    blur: baseBlur * mult,
    spread: baseSpread * mult,
    opacity: Math.min(1, mult),
  }
}

export function getGlowCSSVar(globalIntensity: number = 75) {
  return `--glow-multiplier: ${globalIntensity / 100};`
}
