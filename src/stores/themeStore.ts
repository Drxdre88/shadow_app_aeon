import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, type ThemeName, type ThemeColors } from '@/config/themes'

export type FontFamily = 'system' | 'inter' | 'jetbrains' | 'space-grotesk' | 'fira-code'
export type DragEffect = 'glow' | 'ghost' | 'lightning'
export type DepLineStyle = 'solid' | 'dashed' | 'dotted'
export type CursorEffect = 'none' | 'glow' | 'particles' | 'combo' | 'trail' | 'neon' | 'fire' | 'ice' | 'portal' | 'venom' | 'plasma' | 'blood-moon' | 'smoke' | 'inferno-smoke' | 'venom-smoke' | 'plasma-smoke' | 'blood-moon-smoke' | 'custom-smoke'

export interface CustomPriority {
  id: string
  name: string
  color: string
}

export const INITIAL_PRIORITIES = [
  { id: 'low', name: 'low', color: '#64748b' },
  { id: 'medium', name: 'medium', color: '#3b82f6' },
  { id: 'high', name: 'high', color: '#f97316' },
  { id: 'urgent', name: 'urgent', color: '#ef4444' },
]

export const FONT_OPTIONS: { id: FontFamily; label: string; css: string }[] = [
  { id: 'system', label: 'System', css: 'system-ui, -apple-system, sans-serif' },
  { id: 'inter', label: 'Inter', css: 'var(--font-inter), system-ui, sans-serif' },
  { id: 'jetbrains', label: 'JetBrains Mono', css: 'var(--font-jetbrains), monospace' },
  { id: 'space-grotesk', label: 'Space Grotesk', css: 'var(--font-space-grotesk), system-ui, sans-serif' },
  { id: 'fira-code', label: 'Fira Code', css: 'var(--font-fira-code), monospace' },
]

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  openLabel: 'l',
  addTask: 't',
}

interface ThemeStore {
  currentTheme: ThemeName
  colors: ThemeColors
  glowIntensity: number
  glassOpacity: number
  ambientBlobs: boolean
  fontFamily: FontFamily
  dragEffect: DragEffect
  cursorEffect: CursorEffect
  cursorColor: string
  columnWidth: number
  columnHeight: number
  dynamicColumnWidth: boolean
  dynamicColumnHeight: boolean
  smokeVolume: number
  depLineWidth: number
  depLineGlow: number
  depLineStyle: DepLineStyle
  shortcuts: Record<string, string>
  priorities: CustomPriority[]
  setTheme: (theme: ThemeName) => void
  setGlowIntensity: (intensity: number) => void
  setGlassOpacity: (opacity: number) => void
  setAmbientBlobs: (enabled: boolean) => void
  setFontFamily: (font: FontFamily) => void
  setDragEffect: (effect: DragEffect) => void
  setCursorEffect: (effect: CursorEffect) => void
  setCursorColor: (color: string) => void
  setPriorities: (priorities: CustomPriority[]) => void
  updatePriority: (id: string, updates: Partial<CustomPriority>) => void
  addPriority: (priority: CustomPriority) => void
  removePriority: (id: string) => void
  resetPriorities: () => void
  setColumnWidth: (width: number) => void
  setColumnHeight: (height: number) => void
  setDynamicColumnWidth: (enabled: boolean) => void
  setDynamicColumnHeight: (enabled: boolean) => void
  setSmokeVolume: (volume: number) => void
  setDepLineWidth: (width: number) => void
  setDepLineGlow: (glow: number) => void
  setDepLineStyle: (style: DepLineStyle) => void
  setShortcut: (action: string, key: string) => void
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
      dragEffect: 'glow' as DragEffect,
      cursorEffect: 'none' as CursorEffect,
      cursorColor: '',
      columnWidth: 320,
      columnHeight: 500,
      dynamicColumnWidth: true,
      dynamicColumnHeight: true,
      smokeVolume: 75,
      depLineWidth: 1,
      depLineGlow: 60,
      depLineStyle: 'solid' as DepLineStyle,
      shortcuts: { ...DEFAULT_SHORTCUTS },
      priorities: [...INITIAL_PRIORITIES],
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
      setDragEffect: (effect: DragEffect) => {
        set({ dragEffect: effect })
      },
      setCursorEffect: (effect: CursorEffect) => {
        set({ cursorEffect: effect })
      },
      setCursorColor: (color: string) => {
        set({ cursorColor: color })
      },
      setPriorities: (priorities: CustomPriority[]) => {
        set({ priorities })
      },
      updatePriority: (id: string, updates: Partial<CustomPriority>) => {
        set((s) => ({ priorities: s.priorities.map((p) => (p.id === id ? { ...p, ...updates } : p)) }))
      },
      addPriority: (priority: CustomPriority) => {
        set((s) => ({ priorities: [...s.priorities, priority] }))
      },
      removePriority: (id: string) => {
        set((s) => ({ priorities: s.priorities.filter((p) => p.id !== id) }))
      },
      resetPriorities: () => {
        set({ priorities: [...INITIAL_PRIORITIES] })
      },
      setColumnWidth: (width: number) => {
        set({ columnWidth: Math.max(250, Math.min(500, width)) })
      },
      setColumnHeight: (height: number) => {
        set({ columnHeight: Math.max(200, Math.min(800, height)) })
      },
      setDynamicColumnWidth: (enabled: boolean) => {
        set({ dynamicColumnWidth: enabled })
      },
      setDynamicColumnHeight: (enabled: boolean) => {
        set({ dynamicColumnHeight: enabled })
      },
      setSmokeVolume: (volume: number) => {
        set({ smokeVolume: Math.max(0, Math.min(100, Math.round(volume))) })
      },
      setDepLineWidth: (width: number) => {
        set({ depLineWidth: Math.max(0.3, Math.min(3, Math.round(width * 10) / 10)) })
      },
      setDepLineGlow: (glow: number) => {
        set({ depLineGlow: Math.max(0, Math.min(100, glow)) })
      },
      setDepLineStyle: (style: DepLineStyle) => {
        set({ depLineStyle: style })
      },
      setShortcut: (action: string, key: string) => {
        set((s) => ({ shortcuts: { ...s.shortcuts, [action]: key } }))
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
        dragEffect: state.dragEffect,
        cursorEffect: state.cursorEffect,
        cursorColor: state.cursorColor,
        priorities: state.priorities,
        columnWidth: state.columnWidth,
        columnHeight: state.columnHeight,
        dynamicColumnWidth: state.dynamicColumnWidth,
        dynamicColumnHeight: state.dynamicColumnHeight,
        smokeVolume: state.smokeVolume,
        depLineWidth: state.depLineWidth,
        depLineGlow: state.depLineGlow,
        depLineStyle: state.depLineStyle,
        shortcuts: state.shortcuts,
      }),
      merge: (persisted: unknown, current: ThemeStore) => ({
        ...current,
        ...(persisted as Partial<ThemeStore>),
        shortcuts: { ...DEFAULT_SHORTCUTS, ...((persisted as Partial<ThemeStore>)?.shortcuts ?? {}) },
        dynamicColumnWidth: (persisted as Partial<ThemeStore>)?.dynamicColumnWidth ?? current.dynamicColumnWidth,
        dynamicColumnHeight: (persisted as Partial<ThemeStore>)?.dynamicColumnHeight ?? current.dynamicColumnHeight,
        columnHeight: (persisted as Partial<ThemeStore>)?.columnHeight ?? current.columnHeight,
        smokeVolume: (persisted as Partial<ThemeStore>)?.smokeVolume ?? current.smokeVolume,
        depLineWidth: (persisted as Partial<ThemeStore>)?.depLineWidth ?? current.depLineWidth,
        depLineGlow: (persisted as Partial<ThemeStore>)?.depLineGlow ?? current.depLineGlow,
        depLineStyle: (persisted as Partial<ThemeStore>)?.depLineStyle ?? current.depLineStyle,
      }),
    }
  )
)
