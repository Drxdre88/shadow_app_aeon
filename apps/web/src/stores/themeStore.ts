import { create } from 'zustand'
import {
  themes,
  DEFAULT_PREFERENCES,
  DEFAULT_SHORTCUTS,
  INITIAL_PRIORITIES,
  type ThemeName,
  type ThemeColors,
  type CelebrationStyle,
  type FontFamily,
  type DragEffect,
  type DepLineStyle,
  type DepViewMode,
  type CursorEffect,
  type BoardLayout,
  type CompletionMode,
  type ProjectViewMode,
  type ProjectSortMode,
  type CustomPriority,
  type GlowSource,
} from '@aeon/shared'

export type {
  FontFamily,
  DragEffect,
  DepLineStyle,
  DepViewMode,
  CursorEffect,
  BoardLayout,
  CompletionMode,
  ProjectViewMode,
  ProjectSortMode,
  CustomPriority,
  GlowSource,
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
  businessMode: boolean
  _businessSnapshot: { glowIntensity: number; glassOpacity: number; ambientBlobs: boolean; cursorEffect: CursorEffect; dragEffect: DragEffect; surfaceVibrancy: number } | null
  currentTheme: ThemeName
  colors: ThemeColors
  glowSource: GlowSource
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
  cardPreviewOnHover: boolean
  celebrationStyle: CelebrationStyle
  completionMode: CompletionMode
  boardActionToasts: boolean
  smoothUiRenders: boolean
  depViewMode: DepViewMode
  shortcuts: Record<string, string>
  priorities: CustomPriority[]
  _hydrateFromDB: (prefs: Record<string, unknown>) => void
  setBoardLayout: (layout: BoardLayout) => void
  setDefaultProjectView: (view: ProjectViewMode) => void
  setDefaultProjectSort: (sort: ProjectSortMode) => void
  setProjectColor: (projectId: string, color: string) => void
  setTheme: (theme: ThemeName) => void
  setGlowSource: (source: GlowSource) => void
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
  setCardPreviewOnHover: (enabled: boolean) => void
  setCelebrationStyle: (style: CelebrationStyle) => void
  setBoardActionToasts: (enabled: boolean) => void
  setSmoothUiRenders: (enabled: boolean) => void
  setBusinessMode: (enabled: boolean) => void
  setShortcut: (action: string, key: string) => void

  _boardThemeSnapshot: { currentTheme: ThemeName; colors: ThemeColors } | null
  _boardThemeProjectId: string | null
  applyBoardTheme: (projectId: string, themeName: ThemeName) => void
  clearBoardTheme: () => void
}

export const useThemeStore = create<ThemeStore>()((set) => ({
  _hydrated: false,
  businessMode: false,
  _businessSnapshot: null,
  currentTheme: DEFAULT_PREFERENCES.currentTheme as ThemeName,
  colors: themes[DEFAULT_PREFERENCES.currentTheme as ThemeName] ?? themes.deepSpace,
  glowSource: DEFAULT_PREFERENCES.glowSource,
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
  cardPreviewOnHover: false,
  celebrationStyle: 'confetti-burst' as CelebrationStyle,
  completionMode: DEFAULT_PREFERENCES.completionMode as CompletionMode,
  boardActionToasts: DEFAULT_PREFERENCES.boardActionToasts,
  smoothUiRenders: true,
  depViewMode: DEFAULT_PREFERENCES.depViewMode,
  shortcuts: { ...DEFAULT_PREFERENCES.shortcuts },
  priorities: [...DEFAULT_PREFERENCES.priorities],

  _hydrateFromDB: (prefs: Record<string, unknown>) => {
    const SAFE_PREF_KEYS = new Set([
      'currentTheme', 'glowSource', 'glowIntensity', 'glassOpacity', 'themeSaturation',
      'themeBrightness', 'surfaceVibrancy', 'ambientBlobs', 'fontFamily', 'dragEffect',
      'cursorEffect', 'cursorColor', 'columnWidth', 'columnHeight', 'dynamicColumnWidth',
      'dynamicColumnHeight', 'smokeVolume', 'depLineWidth', 'depLineGlow', 'depLineStyle',
      'depCanvasBlur', 'spacePlanetGlow', 'spaceOrbitSpeed', 'boardLayout', 'projectColors',
      'depViewMode', 'completionMode', 'boardActionToasts', 'smoothUiRenders', 'shortcuts', 'priorities',
      'defaultProjectView', 'defaultProjectSort', 'cardPreviewOnHover', 'celebrationStyle',
    ])
    const safePrefs = Object.fromEntries(
      Object.entries(prefs).filter(([k]) => SAFE_PREF_KEYS.has(k))
    )
    const themeName = (safePrefs.currentTheme as ThemeName) ?? DEFAULT_PREFERENCES.currentTheme
    const colors = themes[themeName] ?? themes.deepSpace
    set({
      ...safePrefs,
      currentTheme: themeName,
      colors,
      shortcuts: { ...DEFAULT_SHORTCUTS, ...(safePrefs.shortcuts as Record<string, string> ?? {}) },
      priorities: (() => {
        const saved = safePrefs.priorities as CustomPriority[] | undefined
        if (!saved) return [...INITIAL_PRIORITIES]
        const coreColorMap = new Map(INITIAL_PRIORITIES.map((p) => [p.id, p.color]))
        return saved.map((p) => {
          const defaultColor = coreColorMap.get(p.id)
          return defaultColor ? { ...p, color: defaultColor } : p
        })
      })(),
      projectColors: (safePrefs.projectColors as Record<string, string>) ?? {},
      _hydrated: true,
    })
  },

  setTheme: (theme: ThemeName) => {
    const colors = themes[theme]
    set({ currentTheme: theme, colors })
  },
  setGlowSource: (source: GlowSource) => {
    set({ glowSource: source })
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
  setCardPreviewOnHover: (enabled: boolean) => {
    set({ cardPreviewOnHover: enabled })
  },
  setCelebrationStyle: (style: CelebrationStyle) => {
    set({ celebrationStyle: style })
  },
  setBoardActionToasts: (enabled: boolean) => {
    set({ boardActionToasts: enabled })
  },
  setSmoothUiRenders: (enabled: boolean) => {
    set({ smoothUiRenders: enabled })
  },
  setBusinessMode: (enabled: boolean) => {
    set((s) => {
      if (enabled === s.businessMode) return {}
      if (enabled) {
        return {
          businessMode: true,
          _businessSnapshot: {
            glowIntensity: s.glowIntensity,
            glassOpacity: s.glassOpacity,
            ambientBlobs: s.ambientBlobs,
            cursorEffect: s.cursorEffect,
            dragEffect: s.dragEffect,
            surfaceVibrancy: s.surfaceVibrancy,
          },
          glowIntensity: 0,
          glassOpacity: 0,
          ambientBlobs: false,
          cursorEffect: 'none' as CursorEffect,
          dragEffect: 'ghost' as DragEffect,
          surfaceVibrancy: 0,
        }
      }
      const snap = s._businessSnapshot
      return {
        businessMode: false,
        _businessSnapshot: null,
        ...(snap ? {
          glowIntensity: snap.glowIntensity,
          glassOpacity: snap.glassOpacity,
          ambientBlobs: snap.ambientBlobs,
          cursorEffect: snap.cursorEffect,
          dragEffect: snap.dragEffect,
          surfaceVibrancy: snap.surfaceVibrancy,
        } : {}),
      }
    })
  },
  setShortcut: (action: string, key: string) => {
    set((s) => ({ shortcuts: { ...s.shortcuts, [action]: key } }))
  },

  _boardThemeSnapshot: null,
  _boardThemeProjectId: null,
  applyBoardTheme: (projectId: string, themeName: ThemeName) => {
    set((s) => {
      const newColors = themes[themeName] ?? themes.deepSpace
      const snapshot = s._boardThemeSnapshot
        ? s._boardThemeSnapshot
        : { currentTheme: s.currentTheme, colors: s.colors }
      if (s._boardThemeProjectId && s._boardThemeProjectId !== projectId) {
        return {
          _boardThemeSnapshot: { currentTheme: s.currentTheme, colors: s.colors },
          _boardThemeProjectId: projectId,
          currentTheme: themeName,
          colors: newColors,
        }
      }
      return {
        _boardThemeSnapshot: snapshot,
        _boardThemeProjectId: projectId,
        currentTheme: themeName,
        colors: newColors,
      }
    })
  },
  clearBoardTheme: () => {
    set((s) => {
      if (!s._boardThemeSnapshot) return {}
      return {
        currentTheme: s._boardThemeSnapshot.currentTheme,
        colors: s._boardThemeSnapshot.colors,
        _boardThemeSnapshot: null,
        _boardThemeProjectId: null,
      }
    })
  },
}))

// Single source of truth for UI motion. true = polished animations (default),
// false = everything instant (flattens CSS/Tailwind transitions via the global
// reduce-motion stylesheet, disables Framer motion, and skips JS transition
// timers like the card-click open delay). See ThemeProvider + globals.css.
export const useSmoothUiRenders = () => useThemeStore((s) => s.smoothUiRenders)
