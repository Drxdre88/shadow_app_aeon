'use client'

import { forwardRef } from 'react'
import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { AccentColor, GlowIntensity, colorConfig, glowIntensity as glowConfig } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'

interface NeonButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: React.ReactNode
  // 'theme' (the default) follows the active theme's primary colour; a named
  // accent pins the button to that colour regardless of theme.
  color?: AccentColor | 'theme'
  glowIntensity?: GlowIntensity
  size?: 'sm' | 'md' | 'lg'
  variant?: 'solid' | 'outline' | 'ghost'
  fullWidth?: boolean
  disabled?: boolean
}

const THEME_ACCENT = 'var(--primary)'
const THEME_BORDER = 'color-mix(in srgb, var(--primary) 45%, transparent)'
const THEME_GLOW = 'color-mix(in srgb, var(--primary) 55%, transparent)'

export const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(({
  children,
  color = 'theme',
  glowIntensity: intensity = 'md',
  size = 'md',
  variant = 'solid',
  fullWidth = false,
  disabled = false,
  className,
  ...props
}, ref) => {
  const { glowIntensity: globalGlow } = useThemeStore()
  // An unrecognised colour falls back to the theme rather than a hardcoded accent.
  const colors = color === 'theme' ? null : colorConfig[color] ?? null
  const themed = colors === null
  const accentGlow = colors ? colors.glow : THEME_GLOW
  const glow = glowConfig[intensity]
  const mult = globalGlow / 75

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }

  const variantClasses = {
    solid: cn(
      'bg-gradient-to-b from-white/20 to-black/40',
      colors?.border,
      colors?.text
    ),
    outline: cn(
      'bg-transparent',
      colors?.border,
      colors?.text,
      'hover:bg-white/5'
    ),
    ghost: cn(
      'bg-transparent border-transparent',
      colors?.text,
      'hover:bg-white/5'
    ),
  }

  const themeStyle: React.CSSProperties = themed
    ? { color: THEME_ACCENT, borderColor: variant === 'ghost' ? 'transparent' : THEME_BORDER }
    : {}

  const glowStyle = intensity !== 'none' && !disabled && globalGlow > 0 ? {
    boxShadow: `0 0 ${glow.blur * mult}px ${glow.spread * mult}px ${accentGlow}`,
  } : {}

  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      className={cn(
        'relative overflow-hidden rounded-xl backdrop-blur-md',
        'border font-medium transition-all duration-300',
        sizeClasses[size],
        variantClasses[variant],
        fullWidth && 'w-full',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{ ...themeStyle, ...glowStyle }}
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      {...props}
    >
      {intensity !== 'none' && color !== 'none' && globalGlow > 0 && (
        <div
          className="absolute inset-0 -z-10 animate-glow-breathe"
          style={{
            background: `radial-gradient(circle at center, ${accentGlow} 0%, transparent 70%)`,
            opacity: glow.opacity * 0.5 * mult,
            filter: `blur(${20 * mult}px)`,
          }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </motion.button>
  )
})
NeonButton.displayName = 'NeonButton'
