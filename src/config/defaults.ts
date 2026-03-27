import type {
  FontFamily,
  DragEffect,
  CursorEffect,
  DepLineStyle,
  BoardLayout,
  DepViewMode,
  CustomPriority,
} from '@/stores/themeStore'

export const INITIAL_PRIORITIES: CustomPriority[] = [
  { id: 'low', name: '🟢 low', color: '#64748b' },
  { id: 'medium', name: '🔵 medium', color: '#3b82f6' },
  { id: 'high', name: '🟠 high', color: '#f97316' },
  { id: 'urgent', name: '🔴 urgent', color: '#ef4444' },
]

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  openLabel: 'l',
  addCard: 'c',
  editCard: 'e',
  changeGlow: 'g',
  changePriority: 'v',
  toggleDates: 'd',
  toggleChecklist: 'o',
}

export const DEFAULT_PREFERENCES = {
  currentTheme: 'deepSpace' as string,
  glowIntensity: 40,
  glassOpacity: 40,
  ambientBlobs: false,
  fontFamily: 'jetbrains' as FontFamily,
  dragEffect: 'glow' as DragEffect,
  cursorEffect: 'none' as CursorEffect,
  cursorColor: '',
  columnWidth: 300,
  columnHeight: 1100,
  dynamicColumnWidth: false,
  dynamicColumnHeight: false,
  smokeVolume: 75,
  depLineWidth: 1,
  depLineGlow: 60,
  depLineStyle: 'solid' as DepLineStyle,
  depCanvasBlur: 16,
  spacePlanetGlow: true,
  spaceOrbitSpeed: 1,
  boardLayout: 'scroll' as BoardLayout,
  projectColors: {} as Record<string, string>,
  depViewMode: 'canvas' as DepViewMode,
  completionMode: 'done' as 'done' | 'vault',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  priorities: [...INITIAL_PRIORITIES],
}

export type UserPreferences = typeof DEFAULT_PREFERENCES
