import type {
  FontFamily,
  DragEffect,
  CursorEffect,
  DepLineStyle,
  BoardLayout,
  DepViewMode,
  GlowSource,
  CustomPriority,
  ProjectViewMode,
  ProjectSortMode,
} from '../types'
import type { CelebrationStyle } from '../types/celebrations'

export const INITIAL_PRIORITIES: CustomPriority[] = [
  { id: 'low', name: 'low', color: '#86efac' },
  { id: 'medium', name: 'medium', color: '#fde68a' },
  { id: 'high', name: 'high', color: '#fb923c' },
  { id: 'urgent', name: 'urgent', color: '#ef4444' },
]

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  openLabel: 'l',
  addCard: 'c',
  editCard: 'e',
  changeGlow: 'g',
  changePriority: 'v',
  toggleDates: 'd',
  toggleDone: 'x',
  toggleChecklist: 'o',
  selectCard: 's',
  assignMember: 'm',
}

export const DEFAULT_PREFERENCES = {
  currentTheme: 'deepSpace' as string,
  glowSource: 'manual' as GlowSource,
  glowIntensity: 40,
  glassOpacity: 40,
  themeSaturation: 100,
  themeBrightness: 100,
  surfaceVibrancy: 0,
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
  boardActionToasts: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  priorities: [...INITIAL_PRIORITIES],
  defaultProjectView: 'grid' as ProjectViewMode,
  defaultProjectSort: 'alphabetical' as ProjectSortMode,
  cardPreviewOnHover: false,
  celebrationStyle: 'checkmark-pulse' as CelebrationStyle,
}

export type UserPreferences = typeof DEFAULT_PREFERENCES
