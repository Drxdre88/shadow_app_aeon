# Mobile UX Reconnaissance — Aeon Board App
**Date:** 2403 16:00
**Scope:** Card modal UX, scroll-to-top bug, landscape handling, mobile detection

---

## Executive Summary

Three mobile UX issues investigated. All root causes identified.
Zero mobile-specific modal behavior exists in the codebase — the app is desktop-first with partial responsive polish.

---

## 1. Card Modal Component

**File:** `src/components/board/TaskEditModal.tsx`
**Render mechanism:** Custom `motion.div` overlay, NOT a native `<dialog>` or sheet component.

**Backdrop element (line 193-197):**
```
className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
```
- `fixed inset-0` — full-screen overlay
- `flex items-center justify-center` — centers the inner panel on ALL screen sizes
- No breakpoint differentiation between mobile and desktop

**Inner modal panel (lines 200-210):**
```
className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl mx-3 sm:mx-0"
```
- `max-w-lg` = 32rem (512px) — the modal is capped at 512px wide
- `max-h-[90vh]` — takes up to 90% viewport height
- `mx-3` on mobile, `sm:mx-0` on desktop (≥640px)
- No `w-screen h-screen` or `sm:max-w-lg` pattern — meaning it is NOT full-screen on mobile

**Result:** On mobile it renders as a centered, shrink-wrapped floating card.
No Trello-style bottom sheet or full-screen takeover.

---

## 2. Current Responsive Behavior — Modal CSS

Only responsive CSS found in the modal:
- `mx-3 sm:mx-0` — adds 12px side margin on mobile only
- `p-4 sm:p-6` — slightly smaller padding on mobile (lines 212, 533)

**No landscape/orientation CSS exists anywhere in the codebase.**
Grep for `landscape`, `orientation`, `@media.*max-height`, `safe-area`, `env(safe` — all returned zero results.

---

## 3. Board Scroll Container & Scroll-to-Top Root Cause

**Board outer container** (`ProjectContent.tsx` line 283):
```
<div className="sm:h-[calc(100vh-120px)]">
```
- On mobile (below `sm` breakpoint), there is NO explicit height set — the div is naturally sized
- On desktop (≥640px), the board container is `calc(100vh - 120px)`

**Board inner container** (`TaskBoard.tsx` lines 301-304):
```
boardLayout === 'grid'
  ? 'flex flex-wrap gap-4 pb-4 overflow-visible sm:overflow-auto content-start sm:max-h-[calc(100vh-140px)]'
  : 'flex flex-nowrap gap-4 pb-4 overflow-visible sm:overflow-auto sm:max-h-[calc(100vh-140px)]'
```
- On mobile: `overflow-visible` — NO scroll containment. The columns overflow the natural document flow.
- On desktop: `overflow-auto` with `max-h-[calc(100vh-140px)]` — scroll is contained.

**On mobile, the page scroll is handled by the browser's document scroll, not a contained div.**

**The scroll-to-top bug mechanism:**

When the `TaskEditModal` opens and mounts, the name input has `autoFocus` (line 227):
```jsx
<input ... autoFocus />
```

On iOS Safari and most mobile browsers, when a focused `<input>` appears inside a `fixed` overlay:
1. The virtual keyboard opens
2. The browser attempts to scroll the focused element into view
3. Because the board scroll is on `document` (not a contained element), the browser fires a document scroll reset
4. When the modal closes and the keyboard dismisses, iOS Safari snaps the document scroll back to position 0,0

This is a known iOS Safari bug: `fixed` + `autoFocus` + document-level scroll = viewport jump.
On Android Chrome it is less severe but still visible.

**Secondary cause:** The `motion.div` animation (`scale: 0.9 → 1`, `y: 20 → 0`) on the modal may trigger a layout reflow that further destabilizes the scroll position on mobile.

---

## 4. Viewport Meta Tag

**File:** `src/app/layout.tsx` lines 21-24:
```typescript
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}
```

**Critical findings:**
- `maximum-scale` is NOT set — user pinch-zoom is allowed (fine)
- `viewport-fit=cover` is NOT set — safe areas (notch, home bar) are NOT respected
- `user-scalable=no` is NOT set (correct — accessibility)
- `interactive-widget=resizes-content` is NOT set — on mobile Chrome, the soft keyboard resizes the viewport, which interacts badly with `100vh` calculations

The absence of `viewport-fit=cover` means on notched iPhones, content can be obscured by the notch/home bar indicator.
The absence of `interactive-widget` control means `100vh` values in the board container will shrink when the keyboard opens.

---

## 5. Existing Mobile Detection

**Only one place in the entire codebase:**
`src/components/project/ProjectViewSwitcher.tsx` — a local `useIsMobile()` hook (lines 23-32):
```typescript
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}
```
Used only to prevent the `SpaceView` (3D canvas) on mobile. Not used anywhere in board/modal code.

**No shared mobile detection hook exists.** No `useMediaQuery`. No React context for device type.

---

## 6. Card Edit Flow — Full Sequence

```
User taps card (SortableTaskCard.tsx line 153)
  → onClick={onEdit} fires
  → handleTaskClick in TaskBoard.tsx line 187
  → handleConnectClick (connect-mode guard)
  → handleTaskEdit in TaskBoard.tsx line 171
    → selectTask(taskId) — writes to boardStore
    → setFormData({ ... task data ... })
    → setEditingTask(taskId)
    → setNewTaskColumnId(null)
  → isModalOpen = true (TaskBoard line 277)
  → TaskEditModal renders with isOpen=true
  → AnimatePresence mounts motion.div
  → Name input with autoFocus mounts
  → iOS keyboard fires → document scroll resets

User taps "Save Changes"
  → handleSubmit in TaskBoard line 237
    → updateTask(editingTask, updates) — Zustand store update
    → onTaskUpdate?.(editingTask, updates) — server action (async)
    → setEditingTask(null)
  → isModalOpen = false
  → AnimatePresence unmounts modal (scale+fade out)
  → Keyboard dismisses (iOS)
  → iOS scroll snap fires → viewport jumps to 0,0
```

The board columns do NOT re-render in a way that would itself cause a scroll reset. The scroll jump is purely from iOS keyboard + autoFocus + document-level scroll interaction.

---

## 7. Landscape / Orientation Handling

**Grep result: zero matches for `landscape`, `orientation`, `@media.*max-height`, `safe-area`, `env(safe`.**

Landscape mode is completely unhandled. On phones in landscape:
- The header takes ~48px
- `max-h-[90vh]` on the modal leaves only ~5-10% of remaining height for the inner scrollable content
- The board columns are `height: ${columnHeight}px` (default from themeStore, approximately 600px) — vastly exceeds landscape viewport height
- Horizontal scrolling board columns overflow outside the visible area with no horizontal scroll on mobile (because `overflow-visible` on mobile)

The `KanbanColumn` component uses pixel-based explicit heights set from `useThemeStore`:
```
style={{ height: `${columnHeight}px` }}  // line 263
```
And the outer wrapper:
```
style={{ width: `${columnWidth}px` }}  // line 254
```
These are fixed pixel values from theme settings, with no viewport-relative fallback on mobile.

---

## 8. Files Requiring Changes

| File | Issue | Change Type |
|------|-------|-------------|
| `src/app/layout.tsx` | Missing `viewport-fit=cover`, `interactive-widget` | Viewport meta update |
| `src/components/board/TaskEditModal.tsx` | No full-screen mobile mode, `autoFocus` triggers scroll | Mobile sheet + autoFocus fix |
| `src/components/board/TaskBoard.tsx` | `overflow-visible` on mobile, no scroll containment | Add `overflow-x-auto` on mobile |
| `src/app/project/[id]/ProjectContent.tsx` | Board wrapper missing mobile height constraint | Add mobile height class |
| `src/components/board/KanbanColumn.tsx` | Pixel-height columns break on landscape | Add `max-h-[calc(100svh-120px)]` mobile override |
| `src/app/globals.css` | No safe-area padding, no landscape overrides | Add env(safe-area-inset) rules |

**Optional shared utility:**
- `src/hooks/useIsMobile.ts` — extract the existing `useIsMobile` to a shared hook

---

## Hidden Dependencies & Gotchas

1. **DnD-kit `touchAction: 'none'`** on `SortableTaskCard` (line 154) — prevents native scroll on the card surface. On mobile, users cannot scroll the column by dragging on a card. They must find the gap between cards.

2. **Column height is from themeStore** — `columnHeight` and `columnWidth` are user-configurable. Any CSS override must account for user-set values vs. viewport constraints.

3. **Framer Motion AnimatePresence** — the exit animation (`scale: 0.9, y: 20`) holds the modal in the DOM briefly after close. On iOS, if the keyboard has already dismissed, the document scroll snap can fire during this animation window.

4. **`max-h-[90vh]`** — on mobile with keyboard open, `100vh` is the full viewport including keyboard. The modal could be nearly entirely behind the keyboard. Should use `100dvh` (dynamic viewport height) instead.

5. **No `overscroll-behavior: none`** on modal inner scroll — pulling to extremes can trigger browser chrome navigation (back swipe on iOS).
