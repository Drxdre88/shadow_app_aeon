import { create } from 'zustand'
import { themes, type ThemeName, type ThemeColors } from '@/config/themes'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SHORTCUTS,
  INITIAL_PRIORITIES,
} from '@/config/defaults'

export type FontFamily = 'system' | 'inter' | 'jetbrains' | 'space-grotesk' | 'fira-code'
export type DragEffect = 'glow' | 'ghost' | 'lightning'
export type DepLineStyle = 'solid' | 'dashed' | 'dotted'
export type DepViewMode = 'canvas' | 'arrows'
export type CursorEffect = 'none' | 'glow' | 'particles' | 'combo' | 'trail' | 'neon' | 'fire' | 'ice' | 'portal' | 'venom' | 'plasma' | 'blood-moon' | 'smoke' | 'inferno-smoke' | 'venom-smoke' | 'plasma-smoke' | 'blood-moon-smoke' | 'custom-smoke'
export type BoardLayout = 'scroll' | 'grid'
export type CompletionMode = 'done' | 'vault'
export type ProjectViewMode = 'grid' | 'tree' | 'space'
export type ProjectSortMode = 'alphabetical' | 'custom'

export interface CustomPriority {
  id: string
  name: string
  color: string
}

export { INITIAL_PRIORITIES, DEFAULT_SHORTCUTS }

export const FONT_OPTIONS: { id: FontFamily; label: string; css: string }[] = [
  { id: 'system', label: 'System', css: 'system-ui, -apple-system, sans-serif' },
  { id: 'inter', label: 'Inter', css: 'var(--font-inter), system-ui, sans-serif' },
  { id: 'jetbrains', label: 'JetBrains Mono', css: 'var(--font-jetbrains), monospace' },
  { id: 'space-grotesk', label: 'Space Grotesk', css: 'var(--font-space-grotesk), system-ui, sans-serif' },
  { id: 'fira-code', label: 'Fira Code', css: 'var(--font-fira-code), monospace' },
]

interface ThemeStore {
  _hydrated: boolean
  currentTheme: ThemeName
  colors: ThemeColors
  glowIntensity: number
  glassOpacity: number
  themeSaturation: number
  themeBrightness: number
  surfaceVibrancy: number
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
  depCanvasBlur: number
  spacePlanetGlow: boolean
  spaceOrbitSpeed: number
  boardLayout: BoardLayout
  defaultProjectView: ProjectViewMode
  defaultProjectSort: ProjectSortMode
  projectColors: Record<string, string>
  completionMode: CompletionMode
  depViewMode: DepViewMode
  shortcuts: Record<string, string>
  priorities: CustomPriority[]
  _hydrateFromDB: (prefs: Record<string, unknown>) => void
  setBoardLayout: (layout: BoardLayout) => void
  setDefaultProjectView: (view: ProjectViewMode) => void
  setDefaultProjectSort: (sort: ProjectSortMode) => void
  setProjectColor: (projectId: string, color: string) => void
  setTheme: (theme: ThemeName) => void
  setGlowIntensity: (intensity: number) => void
  setGlassOpacity: (opacity: number) => void
  setThemeSaturation: (saturation: number) => void
  setThemeBrightness: (brightness: number) => void
  setSurfaceVibrancy: (vibrancy: number) => void
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
  setDepCanvasBlur: (blur: number) => void
  setDepViewMode: (mode: DepViewMode) => void
  setSpacePlanetGlow: (enabled: boolean) => void
  setSpaceOrbitSpeed: (speed: number) => void
  setCompletionMode: (mode: CompletionMode) => void
  setShortcut: (action: string, key: string) => void
}

export const useThemeStore = create<ThemeStore>()((set) => ({
  _hydrated: false,
  currentTheme: DEFAULT_PREFERENCES.currentTheme as ThemeName,
  colors: themes[DEFAULT_PREFERENCES.currentTheme as ThemeName] ?? themes.deepSpace,
  glowIntensity: DEFAULT_PREFERENCES.glowIntensity,
  glassOpacity: DEFAULT_PREFERENCES.glassOpacity,
  themeSaturation: DEFAULT_PREFERENCES.themeSaturation,
  themeBrightness: DEFAULT_PREFERENCES.themeBrightness,
  surfaceVibrancy: DEFAULT_PREFERENCES.surfaceVibrancy,
  ambientBlobs: DEFAULT_PREFERENCES.ambientBlobs,
  fontFamily: DEFAULT_PREFERENCES.fontFamily,
  dragEffect: DEFAULT_PREFERENCES.dragEffect,
  cursorEffect: DEFAULT_PREFERENCES.cursorEffect,
  cursorColor: DEFAULT_PREFERENCES.cursorColor,
  columnWidth: DEFAULT_PREFERENCES.columnWidth,
  columnHeight: DEFAULT_PREFERENCES.columnHeight,
  dynamicColumnWidth: DEFAULT_PREFERENCES.dynamicColumnWidth,
  dynamicColumnHeight: DEFAULT_PREFERENCES.dynamicColumnHeight,
  smokeVolume: DEFAULT_PREFERENCES.smokeVolume,
  depLineWidth: DEFAULT_PREFERENCES.depLineWidth,
  depLineGlow: DEFAULT_PREFERENCES.depLineGlow,
  depLineStyle: DEFAULT_PREFERENCES.depLineStyle,
  depCanvasBlur: DEFAULT_PREFERENCES.depCanvasBlur,
  spacePlanetGlow: DEFAULT_PREFERENCES.spacePlanetGlow,
  spaceOrbitSpeed: DEFAULT_PREFERENCES.spaceOrbitSpeed,
  boardLayout: DEFAULT_PREFERENCES.boardLayout,
  defaultProjectView: 'grid' as ProjectViewMode,
  defaultProjectSort: 'alphabetical' as ProjectSortMode,
  projectColors: { ...DEFAULT_PREFERENCES.projectColors },
  completionMode: DEFAULT_PREFERENCES.completionMode as CompletionMode,
  depViewMode: DEFAULT_PREFERENCES.depViewMode,
  shortcuts: { ...DEFAULT_PREFERENCES.shortcuts },
  priorities: [...DEFAULT_PREFERENCES.priorities],

  _hydrateFromDB: (prefs: Record<string, unknown>) => {
    const themeName = (prefs.currentTheme as ThemeName) ?? DEFAULT_PREFERENCES.currentTheme
    const colors = themes[themeName] ?? themes.deepSpace
    set({
      ...prefs,
      currentTheme: themeName,
      colors,
      shortcuts: { ...DEFAULT_SHORTCUTS, ...(prefs.shortcuts as Record<string, string> ?? {}) },
      priorities: (prefs.priorities as CustomPriority[]) ?? [...INITIAL_PRIORITIES],
      projectColors: (prefs.projectColors as Record<string, string>) ?? {},
      _hydrated: true,
    })
  },

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
  setThemeSaturation: (saturation: number) => {
    set({ themeSaturation: Math.max(50, Math.min(200, Math.round(saturation))) })
  },
  setThemeBrightness: (brightness: number) => {
    set({ themeBrightness: Math.max(50, Math.min(150, Math.round(brightness))) })
  },
  setSurfaceVibrancy: (vibrancy: number) => {
    set({ surfaceVibrancy: Math.max(0, Math.min(100, Math.round(vibrancy))) })
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
    set({ columnWidth: Math.max(250, Math.min(1200, width)) })
  },
  setColumnHeight: (height: number) => {
    set({ columnHeight: Math.max(200, Math.min(1600, height)) })
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
  setDepCanvasBlur: (blur: number) => {
    set({ depCanvasBlur: Math.max(0, Math.min(40, Math.round(blur))) })
  },
  setBoardLayout: (layout: BoardLayout) => {
    set({ boardLayout: layout })
  },
  setDefaultProjectView: (view: ProjectViewMode) => {
    set({ defaultProjectView: view })
  },
  setDefaultProjectSort: (sort: ProjectSortMode) => {
    set({ defaultProjectSort: sort })
  },
  setProjectColor: (projectId: string, color: string) => {
    set((s) => ({ projectColors: { ...s.projectColors, [projectId]: color } }))
  },
  setDepViewMode: (mode: DepViewMode) => {
    set({ depViewMode: mode })
  },
  setSpacePlanetGlow: (enabled: boolean) => {
    set({ spacePlanetGlow: enabled })
  },
  setSpaceOrbitSpeed: (speed: number) => {
    set({ spaceOrbitSpeed: Math.max(0, Math.min(5, speed)) })
  },
  setCompletionMode: (mode: CompletionMode) => {
    set({ completionMode: mode })
  },
  setShortcut: (action: string, key: string) => {
    set((s) => ({ shortcuts: { ...s.shortcuts, [action]: key } }))
  },
}))
