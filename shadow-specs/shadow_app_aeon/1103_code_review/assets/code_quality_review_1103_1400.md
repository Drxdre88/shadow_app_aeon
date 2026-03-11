# SHADOW JUDGE REVIEW - shadow_app_aeon
**Date:** 2026-03-11
**Reviewer:** shadow-judge (Claude Opus 4.6)
**Scope:** src/components/, src/stores/, src/config/themes/, src/app/

## OVERALL SCORE: 58/100

---

## Core Intent Assessment

This is a Next.js 14+ project management application ("Aeon") featuring Kanban boards, Gantt charts, and a highly customizable theming/effects system. The core intent is clear: a beautiful, visually rich project management tool with deep personalization.

The app achieves its visual goals but has accumulated significant technical debt through duplicated constants, oversized files, and a settings system that has grown far beyond maintainable boundaries. The effects subsystem (particularly CursorEffect at 779 lines) is the primary offender.

---

## FILE SIZE COMPLIANCE

### CRITICAL VIOLATIONS (>500 lines - ABSOLUTE MAX exceeded)
| File | Lines | Status |
|------|-------|--------|
| `src/components/ui/SettingsModal.tsx` | 870 | FAIL - 1.74x over limit |
| `src/components/effects/CursorEffect.tsx` | 779 | FAIL - 1.56x over limit |
| `src/components/board/TaskBoard.tsx` | 647 | FAIL - 1.29x over limit |

### WARNING ZONE (400-500 lines)
| File | Lines | Status |
|------|-------|--------|
| `src/components/board/KanbanColumn.tsx` | 455 | WARNING - approaching limit |
| `src/app/project/[id]/ProjectContent.tsx` | 441 | WARNING - approaching limit |

### COMPLIANT FILES
All other files are within the 300-400 ideal range or below.

---

## Standards Compliance

### Comments: PASS
No inline comment lines (#//) found anywhere in the codebase. Code is self-documenting through naming. Clean.

### OOP/Composition Patterns: PASS (with notes)
- Zustand stores follow composition over inheritance correctly
- Components compose via props and sub-components
- ThemeEffects acts as a proper composition switch
- ThemeProvider correctly applies CSS variables without inheritance

### Import Style: PASS
- All imports use `@/` path aliases (absolute paths)
- No relative `./` or `../` imports crossing module boundaries
- Sub-module imports within `board/` use `./` which is appropriate for co-located components

### Documentation: N/A (TypeScript project)
- TypeScript interfaces serve as documentation
- No unnecessary JSDoc or docstrings cluttering the code

### Design Focus: MIXED
- Core board/gantt functionality is focused and clean
- The effects/cursor system has grown into a feature zoo (16 cursor effects) without corresponding architectural maturity
- Settings modal has become a monolith

---

## Critical Issues

### 1. PALETTE_COLORS duplicated 4 times (CRITICAL)
The exact same 35-color hex array is copy-pasted into:
- `src/components/board/KanbanColumn.tsx` (line 18)
- `src/components/board/TaskContextMenu.tsx` (line 22)
- `src/components/board/TaskEditModal.tsx` (line 15)
- `src/components/board/ColumnContextMenu.tsx` (line 22)

This should be a single export from `src/lib/utils/colors.ts`.

### 2. ACCENT_COLORS duplicated 4 times (CRITICAL)
Same array redeclared in:
- `KanbanColumn.tsx`
- `TaskContextMenu.tsx`
- `TaskEditModal.tsx`
- `ColumnContextMenu.tsx`

One list even differs (`TaskEditModal` has 6 items, others have 7). Inconsistency waiting to cause bugs.

### 3. generateId() duplicated 4 times (CRITICAL)
Identical `generateId` function defined in:
- `TaskBoard.tsx` (line 63)
- `TaskEditModal.tsx` (line 46)
- `LabelPicker.tsx` (line 22)
- `QuickAddTask.tsx` (line 50)

Should be a single utility in `src/lib/utils/`.

### 4. CursorEffect.tsx at 779 lines (CRITICAL)
Contains 14 separate custom hooks (useGlowFollower, useParticles, useRipple, useSparkle, useTrail, useNeonLine, useFire, useIce, useLightningBolt, usePortal, useVenom, usePlasma, useBloodMoon, useMagnetic) all in one file. Many of these hooks are nearly identical (useFire, useVenom, usePlasma, useBloodMoon are the same pattern with different hue values).

### 5. SettingsModal.tsx at 870 lines (CRITICAL)
Contains 8 sub-components (GlowSlider, PaletteTab, TypographyTab, PriorityManager, ToggleRow, CompactSlider, BoardLayoutSetting, GeneralTab, EffectsTab, ShortcutsTab) plus the main SettingsModal and SettingsButton - all in one file. Each tab should be its own file.

### 6. console.error used for error handling (MODERATE)
`ProjectContent.tsx` has 16 instances of `.catch((err) => console.error(...))`. No user-facing error handling, no toast notifications, no retry logic. Errors are silently swallowed from the user's perspective.

---

## Architectural Concerns

### Theme Store Bloat
`themeStore.ts` (206 lines) contains 26 state properties and 18 setter functions. The interface is becoming unwieldy. The merge function (lines 193-203) already shows fragility with explicit field-by-field fallbacks for newer properties.

### Color Picker Redundancy
The color picker UI pattern (accent colors + palette grid + native picker) is implemented from scratch in at least 3 components. This should be a shared `<ColorPicker>` component.

### ProjectContent.tsx as a God Component
`ProjectContent.tsx` at 441 lines handles: loading state, error state, board data loading, gantt data loading, task CRUD callbacks, column CRUD callbacks, dependency callbacks, label callbacks, gantt task callbacks, and the full page layout. It is a callback factory that violates single responsibility.

### Cursor Effect Architecture
The 14 cursor hooks all follow nearly identical patterns of:
1. Create DOM elements via document.createElement
2. Attach mousemove listener
3. Animate via requestAnimationFrame or CSS transitions
4. Clean up on unmount

5 of these hooks (useFire, useVenom, usePlasma, useBloodMoon, and the fire-style ones) differ only in hue values. This is a textbook case for a parameterized factory function.

---

## Positive Observations

1. **No code comments** - perfectly clean, self-documenting code throughout
2. **Consistent import paths** - `@/` alias used everywhere correctly
3. **Well-structured theme system** - themes split by category (standard, cinematic, vibrant, muted, highContrast) with clean index barrel
4. **Clean Zustand stores** - both boardStore and themeStore follow good patterns with persist middleware
5. **Component granularity in board/** - good decomposition into SortableColumn, SortableTaskCard, DependencyIndicator, etc.
6. **Proper cleanup** - all useEffect hooks properly clean up event listeners and animation frames
7. **TypeScript interfaces** - well-typed props and state throughout
8. **ThemeProvider** is lean and focused (58 lines)
9. **ThemeEffects** composition switch is clean and minimal (22 lines)
10. **GlowCard** component is well-designed as a reusable primitive (92 lines)

---

## Required Changes (Priority Order)

### P0 - Must Fix
1. Extract `PALETTE_COLORS` and `ACCENT_COLORS` to `src/lib/utils/colors.ts`
2. Extract `generateId()` to `src/lib/utils/id.ts`
3. Split `CursorEffect.tsx` into `src/components/effects/cursor/` directory with individual effect files and a factory for hue-parameterized effects
4. Split `SettingsModal.tsx` into `src/components/ui/settings/` directory with one file per tab

### P1 - Should Fix
5. Split `TaskBoard.tsx` by extracting `TrashDropZone`, `DragPreview`, and the connect-mode UI into separate files
6. Create shared `<ColorPicker>` component to eliminate the 3 identical color picker implementations
7. Extract callback factory from `ProjectContent.tsx` into a custom hook (`useProjectCallbacks`)

### P2 - Nice to Have
8. Replace `console.error` catch handlers with user-facing toast notifications
9. Create parameterized cursor effect factory to collapse 5 near-identical hooks into 1
10. Consider splitting themeStore into sub-stores (appearance, effects, board-layout, shortcuts)

---

## Strategic Recommendations

The effects system (cursor effects, theme effects) has grown organically into a feature showcase without maintaining engineering discipline. The 16 cursor effects and the 870-line settings modal are symptoms of feature creep that prioritizes visual novelty over code maintainability.

**Recommended refactor path:**
1. Create `src/components/effects/cursor/` directory with an `effects/` sub-folder containing individual effect files
2. Create `src/components/ui/settings/` directory with tab components
3. Create `src/lib/utils/constants.ts` for shared color/palette constants
4. Create `src/lib/utils/id.ts` for generateId
5. Create `src/components/board/ColorPicker.tsx` shared component

The "return after 6 months" test: A developer returning to CursorEffect.tsx or SettingsModal.tsx would need significant time to navigate 800+ lines of tightly packed effects code. The duplicate constants would inevitably lead to one getting updated while others don't.
