import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, type ThemeName, type ThemeColors } from '@/config/themes'

interface ThemeStore {
  currentTheme: ThemeName
  colors: ThemeColors
  glowIntensity: number
  setTheme: (theme: ThemeName) => void
  setGlowIntensity: (intensity: number) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      currentTheme: 'deepSpace',
      colors: themes.deepSpace,
      glowIntensity: 75,
      setTheme: (theme: ThemeName) => {
        const colors = themes[theme]
        set({ currentTheme: theme, colors })
      },
      setGlowIntensity: (intensity: number) => {
        set({ glowIntensity: Math.max(0, Math.min(100, intensity)) })
      },
    }),
    {
      name: 'aeon-theme',
      partialize: (state) => ({
        currentTheme: state.currentTheme,
        colors: state.colors,
        glowIntensity: state.glowIntensity,
      }),
    }
  )
)
