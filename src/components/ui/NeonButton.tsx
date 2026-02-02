'use client'

import { forwardRef } from 'react'
import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { AccentColor, GlowIntensity, colorConfig, glowIntensity as glowConfig } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'

interface NeonButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: React.ReactNode
  color?: AccentColor
  glowIntensity?: GlowIntensity
  size?: 'sm' | 'md' | 'lg'
  variant?: 'solid' | 'outline' | 'ghost'
  fullWidth?: boolean
  disabled?: boolean
}

export const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(({
  children,
  color = 'purple',
  glowIntensity: intensity = 'md',
  size = 'md',
  variant = 'solid',
  fullWidth = false,
  disabled = false,
  className,
  ...props
}, ref) => {
  const { glowIntensity: globalGlow } = useThemeStore()
  const colors = colorConfig[color]
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
      colors.border,
      colors.text
    ),
    outline: cn(
      'bg-transparent',
      colors.border,
      colors.text,
      'hover:bg-white/5'
    ),
    ghost: cn(
      'bg-transparent border-transparent',
      colors.text,
      'hover:bg-white/5'
    ),
  }

  const glowStyle = intensity !== 'none' && !disabled && globalGlow > 0 ? {
    boxShadow: `0 0 ${glow.blur * mult}px ${glow.spread * mult}px ${colors.glow}`,
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
      style={glowStyle}
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      {...props}
    >
      {intensity !== 'none' && color !== 'none' && globalGlow > 0 && (
        <div
          className="absolute inset-0 -z-10 animate-glow-breathe"
          style={{
            background: `radial-gradient(circle at center, ${colors.glow} 0%, transparent 70%)`,
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
