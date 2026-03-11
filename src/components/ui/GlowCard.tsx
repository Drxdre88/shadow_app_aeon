'use client'

import { forwardRef } from 'react'
import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { colorConfig, glowIntensity as glowConfig, resolveColor, type GlowIntensity } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'

interface GlowCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode
  accentColor?: string
  glowIntensity?: GlowIntensity
  showAccentLine?: boolean
  hover?: boolean
  selected?: boolean
}

export const GlowCard = forwardRef<HTMLDivElement, GlowCardProps>(({
  children,
  accentColor = 'none',
  glowIntensity: intensity = 'none',
  showAccentLine = false,
  hover = false,
  selected = false,
  className,
  ...props
}, ref) => {
  const { glowIntensity: globalGlow } = useThemeStore()
  const resolved = resolveColor(accentColor)
  const presetColors = resolved.isPreset && resolved.presetKey ? colorConfig[resolved.presetKey] : null
  const effectiveIntensity = selected ? 'lg' : intensity
  const mult = globalGlow / 75

  const baseGlow = effectiveIntensity !== 'none' && globalGlow > 0
    ? `0 0 ${glowConfig[effectiveIntensity].blur * mult}px ${glowConfig[effectiveIntensity].spread * mult}px ${resolved.glow}`
    : ''

  const glowStyle: React.CSSProperties = {
    boxShadow: [
      baseGlow,
      'inset 0 1px 0 0 rgba(255,255,255,0.1)',
      '0 8px 32px rgba(0,0,0,0.3)',
    ].filter(Boolean).join(', '),
    ...(!resolved.isPreset ? resolved.borderStyle : {}),
  }

  const accentLineGlow = showAccentLine && accentColor !== 'none' ? {
    boxShadow: `0 0 ${20 * mult}px ${5 * mult}px ${resolved.glow}`,
  } : {}

  const gradientOpacity = 0.15 * mult

  return (
    <motion.div
      ref={ref}
      className={cn(
        'relative p-4 rounded-xl backdrop-blur-xl',
        'bg-gradient-to-b from-white/10 to-black/30',
        'border transition-all duration-300',
        presetColors ? presetColors.border : 'border-white/10',
        hover && 'hover:bg-white/15 hover:border-white/20 cursor-pointer',
        selected && 'ring-2 ring-offset-2 ring-offset-background',
        selected && presetColors && presetColors.ring,
        className
      )}
      style={glowStyle}
      whileHover={hover ? { scale: 1.02, y: -2 } : {}}
      whileTap={hover ? { scale: 0.98 } : {}}
      {...props}
    >
      {showAccentLine && accentColor !== 'none' && globalGlow > 0 && (
        <>
          <div
            className={cn(
              'absolute top-0 left-1 right-1 h-[2px] rounded-t-xl',
              presetColors ? presetColors.bgSolid : ''
            )}
            style={{ ...accentLineGlow, ...(!resolved.isPreset ? resolved.bgSolidStyle : {}) }}
          />
          <div
            className="absolute top-0 left-0 right-0 h-16 rounded-t-xl pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, ${resolved.accentGradient}, transparent)`,
            }}
          />
        </>
      )}
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
})
GlowCard.displayName = 'GlowCard'
