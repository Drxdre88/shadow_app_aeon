# Aeon Android App — Technical Evaluation

## Why Native Over Mobile Web

Aeon's current stack (Next.js 16 + glassmorphism + DnD Kit + Framer Motion) is desktop-first. On mobile:
- Drag-and-drop via `@dnd-kit` doesn't translate well to touch
- Glassmorphism blur/glow effects are GPU-heavy on mobile browsers
- Kanban columns need horizontal + vertical nested scrolling
- Gantt charts are unusable on small screens in a browser

A native app delivers 60fps drag-and-drop, native gestures, offline support, and push notifications.

---

## Recommended Stack: React Native + Expo

### Why React Native
1. **Shared knowledge** — team already works in React + TypeScript + Zustand
2. **Shared types** — Zod validators and TypeScript types extract into a shared package
3. **Shared API layer** — REST endpoints at `/api/v1/projects/[id]/*` are clean and ready
4. **MCP compatibility** — mobile app uses the same API as the web

---

## Proposed Monorepo Architecture

```
/packages
  /shared              ← Extracted from current codebase
    /types             ← Task, Column, Label, Project types
    /validators        ← Zod schemas
    /api-client        ← Typed fetch wrapper for REST API
    /constants         ← Priorities, statuses, defaults

  /web                 ← Current Next.js app (unchanged)

  /mobile              ← New React Native (Expo) app
    /src
      /screens         ← BoardScreen, GanttScreen, ProjectsScreen
      /components      ← NativeTaskCard, NativeColumn, etc.
      /stores          ← Zustand stores (same patterns, mobile-adapted)
      /navigation      ← React Navigation stack
      /theme           ← Native theme system (all 6 families)
```

---

## Feature Mapping: Web → Android

| Web Feature | Android Approach |
|---|---|
| **Kanban Board** | `react-native-draggable-flatlist` or Reanimated + gesture handler. Horizontal ScrollView for columns, FlatList per column |
| **Drag & Drop** | `react-native-gesture-handler` + `react-native-reanimated` — true 60fps native gestures |
| **Glassmorphism** | `expo-blur` for native blur + `react-native-linear-gradient` |
| **Gantt Chart** | Vertical timeline on phones via `react-native-svg` |
| **Task Edit Modal** | Bottom sheet (`@gorhom/bottom-sheet`) with tabs |
| **Dependency Viz** | `react-native-svg` animated paths |
| **Glow Effects** | `react-native-shadow-2` + animated opacity |
| **Theme System** | Map CSS variable themes to RN StyleSheet + context |
| **Auth** | `expo-auth-session` for Google/GitHub OAuth |
| **Offline** | `@tanstack/react-query` + AsyncStorage persistence |
| **Push Notifications** | `expo-notifications` |
| **Velocity/Analytics** | `victory-native` charts |

---

## Code Reuse from Current Codebase

These can be extracted with minimal changes:

1. **Zod validators** (`/src/lib/data/validators.ts`) — Zod works in RN
2. **TypeScript types** — extract interfaces from Drizzle schema types
3. **Store patterns** (`boardStore.ts`, `ganttStore.ts`) — Zustand works in RN, swap localStorage for AsyncStorage
4. **API client logic** — wrap REST endpoints in typed client
5. **Theme definitions** (`/src/config/themes/`) — map CSS vars to RN styles
6. **Business logic** — dependency cycle detection, velocity calculations, etc.

---

## Mobile-Specific UX Enhancements

- **Swipe actions** on task cards (right = complete, left = archive to vault)
- **Haptic feedback** on drag-and-drop
- **Quick-add widget** — Android home screen widget to create tasks
- **Notification actions** — "Mark Done" directly from notification
- **Camera integration** — attach photos to tasks/comments
- **Voice input** — dictate task descriptions

---

## Phased Rollout

| Phase | Scope |
|---|---|
| **Phase 1** | Board view — columns, cards, drag-and-drop, task editing, labels, checklists |
| **Phase 2** | Auth (Google/GitHub), API sync, offline support, push notifications |
| **Phase 3** | Gantt (simplified timeline), analytics/velocity, vault |
| **Phase 4** | Canvas mode, themes (all 6 families), glow effects |
| **Phase 5** | Widgets, deep links, share extensions |

---

## Alternative Considered: Capacitor/PWA Wrapper

Wrapping Next.js in Capacitor is possible but inadvisable:
- DnD Kit drag-and-drop remains janky on touch
- CSS glassmorphism stays GPU-heavy
- You'd fight the web instead of leveraging the platform
- Trello followed this path and eventually went fully native

**Verdict: React Native + Expo is the right approach.** Keeps TypeScript/React expertise, shares significant code, delivers genuinely native UX.
