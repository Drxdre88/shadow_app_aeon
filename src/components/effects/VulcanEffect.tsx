'use client'

import { useThemeStore } from '@/stores/themeStore'

export function VulcanEffect() {
  const { colors } = useThemeStore()

  return (
    <div className="fixed inset-0 pointer-events-none z-[1]">
      <div
        className="absolute bottom-0 left-0 right-0 h-40"
        style={{
          background: `linear-gradient(to top, ${colors.glowColor.replace(/[\d.]+\)$/, '0.08)')}, transparent)`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{
          background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
          boxShadow: `0 0 30px 10px ${colors.glowColor}`,
        }}
      />
    </div>
  )
}
