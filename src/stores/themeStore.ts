import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, type ThemeName, type ThemeColors } from '@/config/themes'

export type FontFamily = 'system' | 'inter' | 'jetbrains' | 'space-grotesk' | 'fira-code'

export const FONT_OPTIONS: { id: FontFamily; label: string; css: string }[] = [
  { id: 'system', label: 'System', css: 'system-ui, -apple-system, sans-serif' },
  { id: 'inter', label: 'Inter', css: 'var(--font-inter), system-ui, sans-serif' },
  { id: 'jetbrains', label: 'JetBrains Mono', css: 'var(--font-jetbrains), monospace' },
  { id: 'space-grotesk', label: 'Space Grotesk', css: 'var(--font-space-grotesk), system-ui, sans-serif' },
  { id: 'fira-code', label: 'Fira Code', css: 'var(--font-fira-code), monospace' },
]

interface ThemeStore {
  currentTheme: ThemeName
  colors: ThemeColors
  glowIntensity: number
  glassOpacity: number
  ambientBlobs: boolean
  fontFamily: FontFamily
  setTheme: (theme: ThemeName) => void
  setGlowIntensity: (intensity: number) => void
  setGlassOpacity: (opacity: number) => void
  setAmbientBlobs: (enabled: boolean) => void
  setFontFamily: (font: FontFamily) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      currentTheme: 'deepSpace',
      colors: themes.deepSpace,
      glowIntensity: 75,
      glassOpacity: 50,
      ambientBlobs: true,
      fontFamily: 'system' as FontFamily,
      setTheme: (theme: ThemeName) => {
        const colors = themes[theme]
        set({ currentTheme: theme, colors })
      },
      setGlowIntensity: (intensity: number) => {
        set({ glowIntensity: Math.max(0, Math.min(100, intensity)) })
      },
      setGlassOpacity: (opacity: number) => {
        set({ glassOpacity: Math.max(0, Math.min(100, opacity)) })
      },
      setAmbientBlobs: (enabled: boolean) => {
        set({ ambientBlobs: enabled })
      },
      setFontFamily: (font: FontFamily) => {
        set({ fontFamily: font })
      },
    }),
    {
      name: 'aeon-theme',
      partialize: (state) => ({
        currentTheme: state.currentTheme,
        colors: state.colors,
        glowIntensity: state.glowIntensity,
        glassOpacity: state.glassOpacity,
        ambientBlobs: state.ambientBlobs,
        fontFamily: state.fontFamily,
      }),
    }
  )
)
