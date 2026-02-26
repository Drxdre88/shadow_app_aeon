import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, type ThemeName, type ThemeColors } from '@/config/themes'

interface ThemeStore {
  currentTheme: ThemeName
  colors: ThemeColors
  glowIntensity: number
  glassOpacity: number
  ambientBlobs: boolean
  setTheme: (theme: ThemeName) => void
  setGlowIntensity: (intensity: number) => void
  setGlassOpacity: (opacity: number) => void
  setAmbientBlobs: (enabled: boolean) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      currentTheme: 'deepSpace',
      colors: themes.deepSpace,
      glowIntensity: 75,
      glassOpacity: 50,
      ambientBlobs: true,
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
    }),
    {
      name: 'aeon-theme',
      partialize: (state) => ({
        currentTheme: state.currentTheme,
        colors: state.colors,
        glowIntensity: state.glowIntensity,
        glassOpacity: state.glassOpacity,
        ambientBlobs: state.ambientBlobs,
      }),
    }
  )
)
