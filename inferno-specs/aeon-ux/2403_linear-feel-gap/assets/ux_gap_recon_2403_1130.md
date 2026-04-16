# SHADOW PROWLER RECONNAISSANCE
## Mission: Linear UX Feel Gap Analysis
**Date:** 2403 | **Agent:** shadow-prowler

---

## Mission Objective
Identify what is missing vs Linear's "instant feel" after the team implemented: SWR cache, optimistic updates with rollback, skeleton loaders, loading.tsx, PWA, mobile fullscreen modal, dvh scroll containment.

---

## Structural Intelligence

### Class Architecture
- **Board stack:** `useProjectData` (polling + SWR-like cache) → `ProjectContent` (tab router) → `TaskBoard` (DnD orchestrator) → `KanbanColumn` → `SortableTaskCard`
- **State:** Zustand `boardStore` (persist, isDirty flag), `ganttStore`, `canvasStore`, `themeStore`
- **Mutations:** All in `useBoardHandlers` — optimistic-first, rollback on catch, toast on error. Pattern is solid everywhere except `handleTaskMove` (no rollback on reorder failure, only `console.error`).
- **Animations:** framer-motion throughout — `motion.div` on cards, modals use spring presets (stiffness 300–400, damping 25–30). GlowCard uses `whileHover scale 1.02 y -2`, `whileTap scale 0.98`.
- **DnD:** `@dnd-kit/core` with `PointerSensor(distance:5)` and `TouchSensor(delay:200)`. DragOverlay drop animation: `duration:300, easing:'cubic-bezier(0.18,0.67,0.6,1.22)'` — custom bounce easing, good.

### Component Relationships
- `TaskEditModal` — no `autoFocus` on name input when modal opens. Focus management absent.
- `QuickAddTask` — has `inputRef.current.focus()` on mount (good).
- `useBoardKeyboardShortcuts` — single-key shortcuts (l, g, v, e, c, d). No Cmd+K. No Ctrl+Z.
- No `CommandPalette` component exists anywhere.
- No multi-select or bulk operation state anywhere in board or store.
- `selectedTaskId` in boardStore is single-select only.

### Data Flow Patterns
- Polling: `setInterval(10_000)` + `visibilitychange` refetch. `isDirty` flag gates polling (won't overwrite in-flight writes).
- No visual indicator of sync state — `isDirty` is internal only, never surfaced to UI.
- No `lastSyncedAt` timestamp exposed anywhere.

### Control Flow Analysis
- Route transitions: Next.js `<Link>` used for dashboard→project nav (prefetch on by default in Next.js 13+ App Router). No explicit `router.prefetch()` calls, no hover-prefetch logic.
- Tab switching (Board/Gantt/Canvas/Trophy/Velocity): plain `useState` — NO exit/enter animation between tabs. Content just swaps instantly with no transition.
- Modal open/close: `AnimatePresence` + spring — good.
- After task delete in modal: `onClose()` called, but focus returns to document body — no focus trap or return-focus logic.
- After task create: modal closes, no scroll-to-new-card, no focus-ring on newly created card.

---

## Design Pattern Detection

| Pattern | Status | Notes |
|---|---|---|
| Optimistic updates | Present | All mutations except task-move reorder (no rollback) |
| Skeleton loaders | Present | `loading.tsx` has realistic board skeleton |
| Toast + Undo | Present | `toast()` global, `onUndo` callback wired for update/delete |
| Ctrl+Z global undo | ABSENT | No `keydown` handler for metaKey+z |
| Command palette | ABSENT | No Cmd+K implementation |
| Multi-select | ABSENT | Single `selectedTaskId` only |
| Focus management | PARTIAL | `autoFocus` in some inputs, absent in `TaskEditModal` main name field |
| Scroll-to-new-card | ABSENT | After create, no ref scroll |
| Page transition animations | ABSENT | Tab switches have no enter/exit animation |
| Sync state indicator | ABSENT | `isDirty` never surfaced |
| `will-change` hints | PARTIAL | Only in DependencyGlowTree and cursor effects |
| Press feedback on plain buttons | PARTIAL | `whileTap` on NeonButton, GlowCard, motion.buttons; plain `<button>` elements lack it |

---

## Historical Context
- Drop animation easing `cubic-bezier(0.18,0.67,0.6,1.22)` is a custom overshoot — gives satisfying snap-back feel.
- Spring configs are moderately tuned (stiffness 300–400). Not over-sprung.
- `isDirty` flag architecture is solid and well-applied — protects polling from clobbering active edits.
- `transition-all duration-200/300` used broadly in Tailwind classes — but these are CSS transitions on box-shadow and border which are GPU-unfriendly at scale.

---

## Hidden Dependencies / Gotchas
- `crossedTaskIds` in `SortableTaskCard.tsx` is a **module-level mutable Set** — not React state. Survives remounts but is not persisted, not serializable, and not rollback-safe.
- `handleTaskMove` in `useBoardHandlers` has no optimistic snapshot/rollback — a network failure leaves the UI in the moved state silently.
- `backdrop-blur-xl` is used on virtually every surface. On mid-range mobile this will cause frame drops during scroll. No `will-change: transform` or compositing hints on scrolling containers.
- The board scroll container uses `max-h-[calc(100dvh-140px)]` + `overflow-auto` — dvh units are correct, but the container has no `contain: strict` or `isolation: isolate` hint.

---

## Quick Win Gap Map (ordered by impact/effort ratio)

### P1 — INSTANT wins, < 15 min each
1. **`autoFocus` on TaskEditModal name input** — modal opens, cursor sits nowhere. One prop adds Linear-like "type immediately" feel.
2. **Tab transition animation** — board/gantt/canvas tabs swap with zero animation. A framer-motion `AnimatePresence` with `key={activeTab}` + `initial opacity:0 y:8` → `animate opacity:1 y:0` costs ~10 lines.
3. **`active:scale-[0.97]` on plain board buttons** — the 30+ plain `<button>` elements (column header +, quick-add, context menu items) have no press feedback. CSS `active:scale-[0.97] transition-transform` is a one-line Tailwind addition.
4. **Ctrl+Z wired to last undo** — the toast system already has `onUndo` callbacks. A global `keydown` listener for `metaKey||ctrlKey + z` that calls the last toast's undo is ~15 lines.

### P2 — HIGH impact, 15–30 min each
5. **Sync state dot in header** — expose `isDirty` from boardStore as a tiny pulsing dot (amber when dirty/syncing, green when clean). Linear has a discrete "Syncing..." indicator. The plumbing is 100% ready — `isDirty` just needs to be read in `ProjectContent` header.
6. **`will-change: transform` on board scroll container** — one inline style on the `overflow-auto` div in `TaskBoard`. Promotes to its own compositor layer, eliminates scroll jank with backdrop-blur children.
7. **Scroll-to-new-card after create** — `addTask` in `handleSubmit` can take a `ref` callback or use `document.querySelector('[data-task-id="..."]')?.scrollIntoView({ behavior:'smooth', block:'nearest' })` immediately after `setNewTaskColumnId(null)`.
8. **Rollback on `handleTaskMove`** — the one mutation without a snapshot. Snapshot `projectTasks` positions before the DnD `handleDragEnd` call, restore on catch.

### P3 — POLISH, visible but not blocking
9. **`contain: paint` on KanbanColumn** — prevents repaint bleed from one column into adjacent ones during DnD. Especially visible with glow effects.
10. **`focus-visible:ring` on interactive elements** — keyboard navigation has no visible focus ring on most buttons. Tab-through the board currently shows nothing.

---

## Reconnaissance Warnings
- Do NOT add `will-change: transform` to card-level elements — at 50+ cards this creates hundreds of compositor layers and will crash mobile GPUs. Apply only to the scroll container.
- The `crossedTaskIds` module Set is a latent bug — if a user deletes a task and creates a new one that gets the same generated ID, the crossed state bleeds. Low probability but worth noting.
- Adding `Cmd+K` without a new package requires building a simple filtered list modal from scratch — feasible but the 30-min cap puts it at the edge. It would require its own spec.

---

## Strategic Recommendations
- Ship P1 items as a single commit — they are single-line or < 10-line changes each and have outsized perceptual impact.
- P2 items change the "alive" feeling of the app — the sync dot and tab transitions are what make Linear feel responsive even when data is loading.
- The biggest remaining gap vs Linear is **Cmd+K** (search/jump) and **multi-select bulk ops** — both require new architecture, defer to a dedicated spec.
