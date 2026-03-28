'use client'

import { useEffect, useState } from 'react'
import { useThemeStore, FONT_OPTIONS } from '@/stores/themeStore'

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '128,128,128'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const { colors, fontFamily, currentTheme, _hydrated, themeSaturation, themeBrightness, surfaceVibrancy } = useThemeStore()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement
    root.style.setProperty('--background', colors.background)
    root.style.setProperty('--surface', colors.surface)
    root.style.setProperty('--surface-hover', colors.surfaceHover)
    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--border-hover', colors.borderHover)
    root.style.setProperty('--text', colors.text)
    root.style.setProperty('--text-muted', colors.textMuted)
    root.style.setProperty('--text-dim', colors.textDim)
    root.style.setProperty('--primary', colors.primary)
    root.style.setProperty('--primary-hover', colors.primaryHover)
    root.style.setProperty('--primary-muted', colors.primaryMuted)
    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--success', colors.success)
    root.style.setProperty('--warning', colors.warning)
    root.style.setProperty('--error', colors.error)
    root.style.setProperty('--glow', colors.glow)
    root.style.setProperty('--glow-color', colors.glowColor)
    root.style.setProperty('--glow-sm', `0 0 10px 2px ${colors.glowColor}`)
    root.style.setProperty('--glow-md', `0 0 20px 5px ${colors.glowColor}`)
    root.style.setProperty('--glow-lg', `0 0 30px 10px ${colors.glowColor}`)
    root.style.setProperty('--glow-xl', `0 0 40px 15px ${colors.glowColor}`)
    root.style.setProperty('--glow-xxl', `0 0 60px 20px ${colors.glowColor}`)

    const satFilter = themeSaturation !== 100 ? `saturate(${themeSaturation}%)` : ''
    const briFilter = themeBrightness !== 100 ? `brightness(${themeBrightness}%)` : ''
    const combinedFilter = [satFilter, briFilter].filter(Boolean).join(' ') || 'none'
    root.style.setProperty('--theme-filter', combinedFilter)

    const vibrancy = surfaceVibrancy / 100
    root.style.setProperty('--surface-tint', vibrancy > 0
      ? `rgba(${hexToRgb(colors.primary)}, ${vibrancy * 0.15})`
      : 'transparent'
    )
    root.style.setProperty('--surface-tint-hover', vibrancy > 0
      ? `rgba(${hexToRgb(colors.primary)}, ${vibrancy * 0.25})`
      : 'transparent'
    )

    const fontCss = FONT_OPTIONS.find((f) => f.id === fontFamily)?.css || FONT_OPTIONS[0].css
    document.body.style.fontFamily = fontCss

    root.dataset.theme = currentTheme

    if (colors.isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [mounted, colors, fontFamily, currentTheme, themeSaturation, themeBrightness, surfaceVibrancy])

  if (!mounted || !_hydrated) {
    return <div style={{ visibility: 'hidden' }}>{children}</div>
  }

  return <>{children}</>
}
