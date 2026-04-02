# ARCHITECTURE.md

Last updated: 2026-04-02

---

## 1. OVERVIEW

Aeon is a project management web application built as a Turborepo monorepo (`apps/web` + `packages/shared`). The stack is **Next.js 16** (App Router) with **TypeScript**, **PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand** for client state, **NextAuth v5** (beta) for authentication, **Tailwind CSS** for styling, and **Framer Motion** for animations. It features a kanban board, Gantt chart, canvas (whiteboard), trophy/vault archive, velocity analytics, 150+ theme presets, an MCP tool server (52 tools) for AI integration, and a Tauri-based desktop shell (scaffold).

---

## 2. DIRECTORY MAP

```
apps/web/                          -- Next.js web application
  src/app/                         -- App Router pages and API routes
  src/app/api/v1/                  -- REST API (session + API key auth)
  src/app/api/[transport]/         -- MCP server (Bearer token auth)
  src/components/board/            -- Kanban board, task edit, DnD, filters
  src/components/canvas/           -- Canvas/whiteboard (ReactFlow)
  src/components/gantt/            -- Gantt chart components
  src/components/trophy/           -- Trophy room / vault archive
  src/components/velocity/         -- Velocity analytics charts
  src/components/celebrations/     -- Task completion celebrations
  src/components/effects/          -- Theme visual effects (particles, etc.)
  src/components/project/          -- Project CRUD, space/tree/grid views
  src/components/sidebar/          -- App sidebar navigation
  src/components/workspace/        -- Realm (workspace) modals
  src/components/ui/               -- Settings, help, command palette, toast
  src/components/providers/        -- ThemeProvider
  src/lib/actions/                 -- Server actions (mutations)
  src/lib/data/                    -- Data access layer (queries)
  src/lib/store/                   -- Zustand stores (board, canvas, gantt, undo)
  src/lib/db/                      -- Drizzle schema + connection
  src/lib/api/                     -- API auth, rate limiting
  src/lib/realtime/                -- Real-time event types (stub)
  src/lib/utils/                   -- Shared utilities (cn, filters, colors)
  src/stores/                      -- Zustand stores (theme, sidebar)
apps/desktop/                      -- Tauri desktop shell (scaffold)
packages/shared/                   -- Shared types, theme presets, filter utils
  src/config/themes/               -- 17 theme categories, 151 presets
  src/types/                       -- Board, canvas, gantt, celebration types
  src/utils/                       -- boardFilters (shared with web)
  src/config/defaults.ts           -- Default preferences + shortcuts
scripts/                           -- Utility scripts (reset-terms)
docs/                              -- Strategic docs, audit notes
shadow-specs/                      -- AI spec workflow directory
```

---

## 3. DATA LAYER

**ORM:** Drizzle ORM with `@neondatabase/serverless` driver.
**Schema file:** `apps/web/src/lib/db/schema.ts`

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | id, email, role, termsAcceptedAt | User accounts |
| `accounts` | userId, provider, providerAccountId | OAuth provider links |
| `sessions` | sessionToken, userId, expires | Database sessions |
| `verification_tokens` | identifier, token, expires | Email verification |
| `projects` | id, userId, name, settings, boardVersion, group | Project definitions |
| `project_members` | projectId, userId, role | Multi-user project sharing |
| `project_invites` | id, projectId, email, token, expiresAt | Invite tokens |
| `workspace_groups` | id, name, ownerId, isPersonal, color | Realms (workspace groups) |
| `group_members` | groupId, userId, role | Realm membership |
| `project_groups` | projectId, groupId | Project-to-realm assignment |
| `board_columns` | id, projectId, name, color, orderIndex | Kanban columns |
| `board_tasks` | id, projectId, columnId, name, priority, size, archivedAt, completedAt | Kanban cards |
| `labels` | id, projectId, name, color | Card labels |
| `task_labels` | taskId, labelId | Label-to-task junction |
| `task_dependencies` | blockerTaskId, blockedTaskId | Task dependency edges |
| `checklist_items` | id, taskId, title, state, status, groupName, orderIndex | Grouped tri-state checklists |
| `task_comments` | id, taskId, userId, content | Card comments |
| `gantt_views` | id, projectId, name, groupBy, filters | Saved Gantt configurations |
| `rows` | id, projectId, ganttViewId, name, orderIndex | Gantt swim-lanes |
| `gantt_tasks` | id, projectId, rowId, boardTaskId, startDate, endDate, progress | Gantt timeline items |
| `canvas_nodes` | id, projectId, type, positionX/Y, name, color | Canvas whiteboard nodes |
| `canvas_edges` | id, projectId, sourceNodeId, targetNodeId, animated | Canvas connections |
| `task_vault` | id, projectId, name, daysTaken, labelSnapshot, checklistSnapshot | Archived trophy data |
| `activity_events` | id, projectId, entityType, action, actorType | Audit log |
| `user_preferences` | userId, preferences (JSONB) | Theme + UI settings |
| `api_keys` | id, userId, keyPrefix, keyHash | MCP/REST API keys |
| `board_snapshots` | id, projectId, token, snapshot, expiresAt | Read-only share links |
| `user_contacts` | id, userId, contactEmail | Contact autocomplete |

**Patterns:** Server actions in `lib/actions/` call data functions in `lib/data/`. API routes in `api/v1/` call the same `lib/data/` functions. All mutations bump `boardVersion` for polling-based sync.

---

## 4. API SURFACE

### REST Routes (`/api/v1/`)

Auth: Session cookie OR `Bearer` API key (via `authenticateRequest`). Rate-limited via `withRateLimit`.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/v1/projects` | List / create projects |
| GET/PUT/DELETE | `/api/v1/projects/[id]` | Get / update / delete project |
| GET | `/api/v1/projects/[id]/summary` | Project summary stats |
| GET | `/api/v1/projects/[id]/velocity` | Velocity analytics data |
| GET/POST | `/api/v1/projects/[id]/columns` | List / create columns |
| PUT/DELETE | `/api/v1/projects/[id]/columns/[columnId]` | Update / delete column |
| PUT | `/api/v1/projects/[id]/columns/reorder` | Reorder columns |
| GET/POST | `/api/v1/projects/[id]/tasks` | List / create tasks |
| POST | `/api/v1/projects/[id]/tasks/batch` | Batch create tasks |
| GET/PUT/DELETE | `/api/v1/projects/[id]/tasks/[taskId]` | CRUD single task |
| GET | `/api/v1/projects/[id]/tasks/[taskId]/detail` | Full task detail |
| GET/POST | `/api/v1/projects/[id]/tasks/[taskId]/checklist` | List / create items |
| POST | `/api/v1/projects/[id]/tasks/[taskId]/checklist/batch` | Batch create items |
| PUT/DELETE | `/api/v1/projects/[id]/tasks/[taskId]/checklist/[itemId]` | Update / delete item |
| GET/POST | `/api/v1/projects/[id]/tasks/[taskId]/comments` | List / create comments |
| PUT/DELETE | `/api/v1/projects/[id]/tasks/[taskId]/comments/[commentId]` | Update / delete comment |
| GET/PUT | `/api/v1/projects/[id]/tasks/[taskId]/labels` | Get / set task labels |
| POST/DELETE | `/api/v1/projects/[id]/tasks/[taskId]/labels/[labelId]` | Add / remove label |
| GET/POST | `/api/v1/projects/[id]/labels` | List / create labels |
| PUT/DELETE | `/api/v1/projects/[id]/labels/[labelId]` | Update / delete label |
| GET/POST | `/api/v1/projects/[id]/dependencies` | List / create deps |
| POST | `/api/v1/projects/[id]/dependencies/batch` | Batch add deps |
| DELETE | `/api/v1/projects/[id]/dependencies/remove` | Remove dependency |
| GET/POST | `/api/v1/projects/[id]/gantt` | List / create gantt tasks |
| PUT/DELETE | `/api/v1/projects/[id]/gantt/[taskId]` | Update / delete gantt task |
| GET/POST | `/api/v1/projects/[id]/canvas` | Get / save canvas state |
| GET/POST | `/api/v1/api-keys` | List / create API keys |
| PATCH/DELETE | `/api/v1/api-keys/[id]` | Revoke / delete key |
| GET/POST | `/api/v1/realms` | List / create realms |
| GET/PUT/DELETE | `/api/v1/realms/[id]` | Get / update / delete realm |
| GET/POST | `/api/v1/realms/[id]/members` | List / invite members |
| PUT/DELETE | `/api/v1/realms/[id]/members/[userId]` | Update role / remove member |
| GET/POST/DELETE | `/api/v1/realms/[id]/projects` | List / add / remove projects |
| GET | `/api/export` | Full data export (JSON) |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/planets` | Planet image list |
| GET | `/api/sync/version/[projectId]` | Board version for polling |
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handlers |

### MCP Tools (`/api/[transport]/`)

Auth: Bearer token (API key or master key). 52 tools across 11 categories:

| Category | Tools | Count |
|---|---|---|
| projects | list, get, create, update, delete, summary | 6 |
| columns | list, create, update, delete, reorder | 5 |
| tasks | list, create, update, delete, get_detail, set_labels | 6 |
| gantt | list, create, update | 3 |
| labels | list, create, update, delete, add_to_task, remove_from_task | 6 |
| checklist | list, create, update, delete, batch_create | 5 |
| comments | list, create, update, delete | 4 |
| dependencies | list, add, remove, batch_add | 4 |
| analytics | get_velocity_stats | 1 |
| bulk | batch_create_tasks | 1 |
| realms | list, create, update, delete, members (list/invite/remove/update_role), projects (list/add/remove) | 11 |

**Parity gaps:** MCP has no canvas tools. REST has export/stats/planets endpoints that MCP lacks. Realm CRUD + members + projects now have full MCP and REST parity. Both MCP and REST enforce `canAccessProject` on realm project assignment. Zod validators added for realm operations. `remove_realm_member` has target-owner guard (cannot remove another owner). `set_project_group` removed (legacy tool).

---

## 5. FEATURE INVENTORY

| Feature | Status | Key Files | Notes |
|---|---|---|---|
| **Board view (Kanban)** | Complete | `components/board/TaskBoard.tsx`, `KanbanColumn.tsx`, `SortableColumn.tsx`, `SortableTaskCard.tsx` | Full DnD via @dnd-kit, column reorder, task move |
| **Drag & Drop** | Complete | `components/board/useBoardDnD.ts`, `DragPreview.tsx` | Custom drag preview, glow/ghost effects |
| **Task CRUD** | Complete | `TaskEditModal.tsx`, `QuickAddTask.tsx` | Inline add + full modal edit |
| **Task context menu** | Complete | `TaskContextMenu.tsx`, `ContextMenuButton.tsx` | Right-click actions |
| **Column context menu** | Complete | `ColumnContextMenu.tsx`, `ColumnDeleteModal.tsx` | Rename, color, delete with migrate |
| **Board filtering** | Complete | `BoardFilterBar.tsx`, `lib/utils/boardFilters.ts` | Text search, priority, label, column, date filters |
| **Keyboard shortcuts** | Complete | `useBoardKeyboardShortcuts.ts`, `shared/config/defaults.ts` | 8 customizable shortcuts (l/c/e/g/v/d/o/s) |
| **Command Palette** | Complete | `ui/CommandPalette.tsx` | Cmd+K via cmdk library |
| **Checklist (tri-state)** | Complete | `board/checklist/TaskChecklist.tsx`, `TriStateCheckbox.tsx`, `SortableChecklistItem.tsx` | Grouped, sortable, tri-state (check/cross/uncheck), status badges |
| **Labels** | Complete | `LabelPicker.tsx`, `TaskLabelsSection.tsx` | Per-project labels, color-coded |
| **Dependencies** | Complete | `TaskDependencySection.tsx`, `DependencyIndicator.tsx`, `BoardDependencyOverlay.tsx`, `DependencyGlowTree.tsx` | Blocker/blocked, SVG overlay, glow tree view, connect mode |
| **Comments** | Complete | `TaskComments.tsx` | Per-task threaded comments |
| **Task sizing** | Complete | `TaskSizeBadge.tsx` | Numeric size for velocity |
| **Stale indicator** | Complete | `StaleIndicator.tsx` | Visual aging indicator |
| **Card peek preview** | Complete | `CardPeekPreview.tsx` | Hover preview of card details |
| **Gantt view** | Complete | `components/gantt/GanttChart.tsx`, `TaskBar.tsx`, `TimelineHeader.tsx`, `RowContainer.tsx` | Day/week/month scale, views, task bars |
| **Gantt views** | Complete | `GanttViewSelector.tsx`, `GanttViewModal.tsx` | Named saved views |
| **Canvas view** | Complete | `components/canvas/CanvasView.tsx`, `IdeaNode.tsx`, `ProcessNode.tsx` | ReactFlow-based whiteboard, auto-layout (dagre), export |
| **Trophy / Vault** | Complete | `components/trophy/TrophyRoom.tsx`, `TrophyCard.tsx`, `TrophyStats.tsx`, `TrophyTimeline.tsx` | Archived tasks, stats, timeline view |
| **Vault archiving** | Complete | `BatchVaultModal.tsx`, `VaultDaysModal.tsx`, `lib/actions/vault.ts` | Auto-vault by days, batch vault |
| **Velocity analytics** | Complete | `components/velocity/VelocityTab.tsx`, `VelocityChart.tsx`, `CycleTimeCard.tsx`, `HeatmapGrid.tsx`, `ColumnFlowBar.tsx` | Throughput, cycle time, heatmap, column flow |
| **Realms (workspaces)** | Complete | `components/workspace/RealmSection.tsx`, `CreateWorkspaceModal.tsx`, `WorkspaceSettingsModal.tsx` | Flat realm list (no personal/team split), TEAM badge, member roles, Orbit icons, two-click delete confirm, number key shortcuts (1-9) for realm switching |
| **Realm REST API** | Complete | `api/v1/realms/` (6 route files) | Full CRUD + members + projects, Zod validation, canAccessProject enforcement |
| **Sidebar navigation** | Complete | `components/sidebar/AppSidebar.tsx`, `components/sidebar/ProjectSidebar.tsx`, `stores/sidebarStore.ts` | Dashboard uses AppSidebar (realm pills + project list). Project board view uses ProjectSidebar (view tabs: Board/Gantt/Canvas/Trophy/Velocity + back arrow to dashboard). ProjectContent uses ProjectSidebar with slim top bar (contextual actions + Cmd+K search bar). Both share `useSidebarStore` for collapse state (persisted with hydration guard). |
| **Hide toggle** | Complete | `stores/sidebarStore.ts` | Per-project and per-realm hide via sidebarStore (persisted), unhide eye button in sidebar bottom |
| **Project CRUD** | Complete | `components/project/CreateProjectModal.tsx`, `EditProjectModal.tsx` | Create, edit, delete, realm assignment (flat list, legacy group field removed) |
| **Project views** | Complete | `SpaceView.tsx`, `TreeView.tsx`, `GridView.tsx`, `ProjectViewSwitcher.tsx` | SpaceView: single unified canvas with realm grouping (defaults fullscreen), TreeView: full right-click context menu, GridView: 3 views with context menus |
| **Theming** | Complete | `packages/shared/src/config/themes/` (17 files), `stores/themeStore.ts` | 151 presets, saturation/brightness/vibrancy sliders |
| **Visual effects** | Complete | `components/effects/` (13 effects), `cursor/` | Starfield, sakura, snowfall, matrix, storm, aurora, cursor trails |
| **Celebrations** | Complete | `components/celebrations/CelebrationEngine.tsx` | 6 categories: alien, business, fun, horror, medieval + registry |
| **Settings modal** | Complete | `ui/settings/SettingsModal.tsx` | Tabs: General, Dashboard, Palette, Effects, Typography, Fun, Shortcuts |
| **Help modal** | Complete | `ui/help/HelpModal.tsx` | Tabs: Board, Gantt, Canvas, Trophy, MCP |
| **Share / invite** | Complete | `board/ShareModal.tsx`, `app/invite/[token]/page.tsx`, `app/share/[token]/` | Project invite via email (Resend), read-only snapshot sharing |
| **Contact autocomplete** | Complete | `ui/ContactAutocomplete.tsx` | Saved contacts for invite |
| **Export** | Complete | `api/export/route.ts` | Full JSON export of all user data |
| **Auth (OAuth)** | Complete | `lib/auth.ts` | Google, GitHub, email (Resend magic link) |
| **API keys** | Complete | `api/v1/api-keys/`, `lib/data/api-keys.ts` | Create/revoke keys for MCP/REST |
| **MCP server** | Complete | `api/[transport]/route.ts`, `tools/` (11 modules) | 52 tools, Bearer auth |
| **Beta terms** | Complete | `app/beta-terms/` | Terms acceptance gate with effects |
| **Undo system** | Complete | `lib/store/undoStore.ts` | 20-entry undo stack |
| **Board sync (polling)** | Complete | `api/sync/version/[projectId]/route.ts`, `lib/actions/board.ts` | Version-based polling |
| **Board theme override** | Complete | `app/project/[id]/useBoardTheme.ts` | Per-project theme override |
| **Toasts** | Complete | `ui/Toast.tsx` | Action confirmation toasts |
| **PWA** | Partial | `components/pwa/ServiceWorkerRegistration.tsx` | Service worker registration exists |
| **Desktop (Tauri)** | Scaffold | `apps/desktop/` | Tauri config + hello-world Rust, no integration |
| **Real-time push** | Not Started | `lib/realtime/index.ts` | `publishBoardEvent()` is a no-op stub |
| **Activity feed UI** | Not Started | DB table `activity_events` exists | Events written but no UI to display them |

---

## 6. STATE MANAGEMENT

All stores use Zustand v5.

| Store | Manages | File | Persistence |
|---|---|---|---|
| `useBoardStore` | Columns, tasks, labels, dependencies, checklist summaries/previews, selection, filters state, crossed tasks | `apps/web/src/lib/store/boardStore.ts` | `zustand/persist` (key: implicit) |
| `useCanvasStore` | Canvas nodes, edges, selection | `apps/web/src/lib/store/canvasStore.ts` | `zustand/persist` |
| `useGanttStore` | Gantt tasks, rows, views, active view, time scale | `apps/web/src/lib/store/ganttStore.ts` | `zustand/persist` |
| `useUndoStore` | Undo stack (max 20 entries) | `apps/web/src/lib/store/undoStore.ts` | None (in-memory) |
| `useThemeStore` | Theme, colors, glow/glass/saturation, font, effects, shortcuts, priorities, layout, board theme override | `apps/web/src/stores/themeStore.ts` | None (hydrates from DB preferences) |
| `useSidebarStore` | Collapsed state, active realm ID, hidden project/realm IDs | `apps/web/src/stores/sidebarStore.ts` | `zustand/persist` (key: `aeon-sidebar`), `onRehydrateStorage` hydration guard |

---

## 7. INTEGRATIONS

| Service | Purpose | Status | Notes |
|---|---|---|---|
| **Neon (PostgreSQL)** | Primary database | Active | `@neondatabase/serverless` driver |
| **NextAuth v5** | Authentication | Active | Database sessions, 30-day max age |
| **Google OAuth** | Sign-in provider | Active | Via `AUTH_GOOGLE_ID`/`SECRET` env |
| **GitHub OAuth** | Sign-in provider | Optional | Dynamic import if env vars present |
| **Resend** | Email (magic link + invites) | Active | Auth provider + invite emails |
| **Vercel** | Hosting (implied) | Active | Next.js deployment target |
| **MCP Protocol** | AI tool integration | Active | 52 tools via `mcp-handler` library |
| **ReactFlow (@xyflow)** | Canvas whiteboard | Active | Nodes, edges, auto-layout |
| **@dnd-kit** | Drag and drop | Active | Kanban columns + tasks |
| **Tauri** | Desktop wrapper | Scaffold | `apps/desktop/` -- not functional |
| **Real-time (WebSocket)** | Push updates | Not Started | `ws` in deps but `publishBoardEvent` is no-op |

---

## 8. KNOWN GAPS & TECHNICAL DEBT

| Issue | Severity | Details |
|---|---|---|
| `publishBoardEvent()` is a no-op | High | `lib/realtime/index.ts` -- real-time push not implemented, relies on polling |
| No virtual scrolling | Medium | Large boards render all cards; no virtualization in columns |
| No `React.memo` usage | Medium | Zero `React.memo` calls across entire codebase |
| MCP lacks canvas tools | Medium | REST has canvas endpoints, MCP does not |
| Activity feed has no UI | Low | `activity_events` table populated but no frontend display |
| Zustand persist hydration flash | Low | sidebarStore now has hydration guard; board/canvas/gantt stores may still flash defaults |
| Desktop app is scaffold only | Low | Tauri config exists, no web-shell integration |
| TODO/FIXME count | None | 0 TODO/FIXME markers in source |
| Test coverage | Low | 8 test files total (stores + actions), no component tests |
| Stores split across two dirs | Low | `src/stores/` (theme, sidebar) vs `src/lib/store/` (board, canvas, gantt, undo) |

---

## 9. RECENT CHANGES (2026-04-02 session)

1. Killed Personal/Team split -- flat realm list in sidebar with TEAM badge
2. Viewport-locked dashboard layout (h-screen overflow-hidden, only main scrolls)
3. Added 6 REST API realm routes (`/api/v1/realms/`) with full CRUD + members + projects
4. Fixed MCP `ok()` helper for void returns
5. Added `canAccessProject` check to `add_project_to_realm` (MCP + REST)
6. SpaceView renders as single unified canvas with realm grouping, defaults to fullscreen
7. EditProjectModal removed legacy group field, flat realm list
8. Sidebar added to ProjectContent (board view) with independent workspace data fetch
9. Hide toggle on projects/realms via sidebarStore (persisted)
10. Unhide eye button in sidebar bottom section
11. TreeView now has full right-click context menu (same as GridView)
12. "Open in new tab" added to ProjectContextMenu
13. Realm delete with two-click confirm in WorkspaceSettingsModal
14. Theme primary color on TopBar view icons + sidebar bottom buttons
15. Realm color dots replaced with Orbit icons, simplified to primary-only coloring
16. Number key shortcuts (1-9) for realm switching on dashboard
17. Zustand persist hydration guard added to sidebarStore (`onRehydrateStorage`)
18. 6 warden micro-fixes (lastUsedColor localStorage, clipboard fallback, GridView hover)
19. Legacy `project.group` fields cleared on all projects
20. Zod validators added for realm operations
21. ProjectSidebar component -- dedicated sidebar for project board view with view tabs, back arrow, slim top bar with only contextual actions
22. ProjectSidebar refactor -- ProjectContent now uses ProjectSidebar exclusively (removed AppSidebar from board view, removed workspace loading). Cmd+K search bar added to project top bar. Dead imports/props cleaned (ChevronLeft, user prop on RealmList, etc.).
23. MCP cleanup -- `set_project_group` tool removed (legacy, 53 -> 52 tools). `remove_realm_member` got target-owner guard. Realm sidebar colors simplified to primary-only.
