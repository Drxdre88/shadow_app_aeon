# ARCHITECTURE.md

Last updated: 2026-05-23

---

## 1. OVERVIEW

Aeon is a project management web application built as a Turborepo monorepo (`apps/web` + `apps/desktop` + `packages/shared`). The stack is **Next.js 16** (App Router, **React Compiler**, **Partial Prerendering**) with **TypeScript**, **PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand** (scoped selectors) for client state, **NextAuth v5** (beta) for authentication, **Tailwind CSS** for styling, and **Framer Motion** for animations. It features a kanban board (with virtual scrolling via TanStack Virtual), Gantt chart, canvas (whiteboard), trophy/vault archive, velocity analytics, 150+ theme presets, an MCP tool server (76 tools) for AI integration, **Pusher** real-time sync (with 30s polling fallback), a **PWA** (manifest + service worker + offline fallback), a **Capacitor** mobile shell (configured), and a Tauri-based desktop shell (scaffold, parked).

**Kairos** is the AI memory layer — a WebGL graph visualisation of user-scoped memories anchored to realms, projects, and tasks. Memories now carry `aiTitle` (1–6 word AI title) and `execSummary` (5–10 bullet array). **Dominions** are a new top-level grouping above Projects that clusters memories and projects in the Kairos view.

---

## 2. DIRECTORY MAP

```
apps/web/                          -- Next.js web application
  src/app/                         -- App Router pages and API routes
  src/app/api/v1/                  -- REST API (session + API key auth)
  src/app/api/v1/memories/         -- Memory REST surface (9 route files)
  src/app/api/[transport]/         -- MCP server (Bearer token auth, 76 tools)
  src/app/kairos/                  -- Kairos memory graph page (renamed from brain/)
  src/components/board/            -- Kanban board, task edit, DnD, filters, virtual scrolling
  src/components/canvas/           -- Canvas/whiteboard (ReactFlow)
  src/components/gantt/            -- Gantt chart components
  src/components/kairos/           -- Kairos graph components (renamed from brain/)
  src/components/kairos/scene/     -- WebGL scene primitives (2D + 3D variants)
  src/components/trophy/           -- Trophy room / vault archive
  src/components/velocity/         -- Velocity analytics charts
  src/components/celebrations/     -- Task completion celebrations
  src/components/effects/          -- Theme visual effects (particles, etc.)
  src/components/project/          -- Project CRUD, space/tree/grid views
  src/components/sidebar/          -- App sidebar navigation (KairosSidebarSection added)
  src/components/ui/kairos/        -- Kairos Setup + Guide modal components
  src/components/workspace/        -- Realm (workspace) modals
  src/components/ui/               -- Settings, help, command palette, toast
  src/components/providers/        -- ThemeProvider
  src/lib/actions/                 -- Server actions (mutations)
  src/lib/actions/dominions.ts     -- Dominion server actions
  src/lib/actions/memories.ts      -- Memory server actions
  src/lib/data/                    -- Data access layer (queries)
  src/lib/data/dominions.ts        -- Dominion CRUD queries
  src/lib/data/memories.ts         -- Memory queries + FTS + graph neighbours
  src/lib/store/                   -- Zustand stores (board, canvas, gantt, undo)
  src/lib/db/                      -- Drizzle schema + connection
  src/lib/api/                     -- API auth, rate limiting
  src/lib/pusher.ts                -- Pusher server singleton
  src/lib/realtime/                -- Real-time event publisher (Pusher)
  src/lib/utils/                   -- Shared utilities (cn, filters, colors)
  src/stores/                      -- Zustand stores (theme, sidebar, kairos)
  src/stores/kairosStore.ts        -- Kairos page selection + refresh signal
  apps/desktop/                    -- Tauri desktop shell (scaffold)
  packages/shared/                 -- Shared types, theme presets, filter utils
    src/config/themes/             -- 17 theme categories, 151 presets
    src/types/                     -- Board, canvas, gantt, celebration types
    src/utils/                     -- boardFilters (shared with web)
    src/config/defaults.ts         -- Default preferences + shortcuts
  scripts/                         -- Utility scripts (reset-terms, brain-anchor-backfill)
  docs/kairos/                     -- Kairos design docs (renamed from docs/brain/)
  shadow-specs/                    -- AI spec workflow directory
```

---

## 3. DATA LAYER

**ORM:** Drizzle ORM with `@neondatabase/serverless` driver.
**Schema file:** `apps/web/src/lib/db/schema.ts`
**Migrations:** `apps/web/drizzle/` — 17 files (0000–0016). Latest: `0016_dominion.sql`, `0015_kairos_summaries.sql`.

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | id, email, role, termsAcceptedAt | User accounts |
| `accounts` | userId, provider, providerAccountId | OAuth provider links |
| `sessions` | sessionToken, userId, expires | Database sessions |
| `verification_tokens` | identifier, token, expires | Email verification |
| `projects` | id, userId, dominionId, name, settings, boardVersion, group | Project definitions (dominionId added migration 0016) |
| `project_members` | projectId, userId, role | Multi-user project sharing |
| `project_invites` | id, projectId, email, token, expiresAt | Invite tokens |
| `workspace_groups` | id, name, ownerId, isPersonal, color, icon | Realms (workspace groups) |
| `group_members` | groupId, userId, role | Realm membership |
| `project_groups` | projectId, groupId, visibility | Project-to-realm assignment |
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
| `realm_invites` | id, groupId, email, token, role, invitedBy, acceptedAt, expiresAt | Realm invite tokens (7-day expiry) |
| `mobile_login_tokens` | id, email, tokenHash, callbackUrl, expiresAt | Mobile magic-link auth |
| `mobile_sessions` | id, userId, tokenHash, expiresAt | Mobile session store |
| `memories` | id, userId, realmId, projectId, taskId, dominionId, title, aiTitle, bodyMd, summary, execSummary (jsonb), type, source, sourceMetadata, links, tags, pinned, archivedAt | Kairos memory nodes. `aiTitle` + `execSummary` added migration 0015. `dominionId` added migration 0016. FTS via raw SQL generated column |
| `dominions` | id, userId, name, color, icon, sortOrder | Kairos top-level groupings above Project (new — migration 0016) |
| `dominion_repos` | dominionId, repoSlug | Repo-slug → Dominion mapping for auto-resolution from session capture sourceMetadata |

**Key patterns:** Three-layer invariant: `lib/data/` (pure queries) → `lib/actions/` (server actions with auth guards) → API surfaces. All mutations call `touchProject()` to bump `boardVersion`. `verifyProjectAccess()` resolves direct membership, owner, and realm membership in 1–2 queries. Dominion resolution order for memory display: `memory.dominionId` ?? `project.dominionId` ?? `dominionRepos` lookup via `sourceMetadata.repo` ?? null (Unassigned).

---

## 4. API SURFACE

### REST Routes (`/api/v1/`)

Auth: Session cookie OR `Bearer` API key (via `authenticateRequest`). Rate-limited via `withRateLimit`.

Full route list omitted for brevity — see `apps/web/src/app/api/v1/**/route.ts`. Notable additions since 2026-04-17:

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/v1/memories` | List / create memories |
| GET/PATCH/DELETE | `/api/v1/memories/[id]` | Get / update / delete memory |
| GET | `/api/v1/memories/search` | FTS search memories |
| GET | `/api/v1/memories/context` | Budget-packed context bundle |
| GET | `/api/v1/memories/needs-summary` | Memories with missing execSummary / aiTitle |
| POST | `/api/v1/memories/[id]/links` | Add typed edge |
| DELETE | `/api/v1/memories/[id]/links/[linkIndex]` | Remove edge |
| GET | `/api/v1/memories/[id]/neighbours` | 1–2 hop graph walk |
| GET | `/api/v1/memories/[id]/export` | Markdown export |

### MCP Tools (`/api/[transport]/`)

Auth: Bearer token (API key or master key). **76 tools** across 13 categories:

| Category | Count | Notes |
|---|---|---|
| projects | 6 | list, get, create, update, delete, summary |
| columns | 5 | list, create, update, delete, reorder |
| tasks | 6 | list, create, update, delete, get_detail, batch_create_tasks |
| gantt | 14 | tasks + rows + saved views, full CRUD + batch |
| labels | 6 | list, create, update, delete, add/remove from task |
| checklist | 5 | list, create, update, delete, batch_create |
| comments | 4 | list, create, update, delete |
| dependencies | 4 | list, add, remove, batch_add |
| analytics | 1 | get_velocity_stats |
| bulk | 1 | setup_board |
| realms | 11 | CRUD + members + projects |
| **memories** | **7** | create, update, search, link, get_with_neighbours, prepare_context, **list_needs_summary** |
| **dominions** | **10** | CRUD + repo mapping + project assignment + bulk assign |

**Parity locks:**
- `src/app/api/__tests__/gantt-parity.test.ts` — 53 assertions, locks Gantt MCP ↔ REST surface.
- `src/app/api/__tests__/memories-parity.test.ts` — locks 7 memory MCP tools vs 9 REST routes; enforces shared validators, shared data functions, `getUserId` / `authenticateRequest` per tool/route.
- Dominion tools (10) are MCP-only — no REST surface yet.
- MCP has no canvas tools (REST-only gap, intentional).

---

## 5. FEATURE INVENTORY

| Feature | Status | Key Files | Notes |
|---|---|---|---|
| **Board view (Kanban)** | Complete | `components/board/TaskBoard.tsx` and family | DnD via @dnd-kit |
| **Drag & Drop** | Complete | `components/board/useBoardDnD.ts` | Custom drag preview |
| **Task CRUD / modal / context menu** | Complete | `TaskEditModal.tsx`, `TaskContextMenu.tsx` | Inline add + modal edit |
| **Column context menu** | Complete | `ColumnContextMenu.tsx` | Rename, color, delete |
| **Board filtering** | Complete | `BoardFilterBar.tsx`, `lib/utils/boardFilters.ts` | Text + priority + label + column + date |
| **Keyboard shortcuts** | Complete | `useBoardKeyboardShortcuts.ts` | 8 customizable shortcuts |
| **Command Palette** | Complete | `ui/CommandPalette.tsx` | Cmd+K via cmdk |
| **Checklist (tri-state)** | Complete | `board/checklist/TaskChecklist.tsx` | Grouped, sortable |
| **Labels** | Complete | `LabelPicker.tsx` | Per-project |
| **Dependencies** | Complete | `TaskDependencySection.tsx`, `BoardDependencyOverlay.tsx` | Blocker/blocked with overlay |
| **Comments** | Complete | `TaskComments.tsx` | Per-task threaded |
| **Task sizing / stale / peek** | Complete | `TaskSizeBadge.tsx`, `StaleIndicator.tsx`, `CardPeekPreview.tsx` | — |
| **Gantt view + saved views** | Complete | `components/gantt/` | Day/week/month scale |
| **Canvas view** | Complete | `components/canvas/CanvasView.tsx` | ReactFlow whiteboard |
| **Trophy / Vault** | Complete | `components/trophy/` | Archived tasks, stats, timeline |
| **Vault archiving (batch)** | Complete | `BatchVaultModal.tsx`, `lib/actions/vault.ts` | `snapshotTaskDataBatch` |
| **Task / column transfer** | Complete | `lib/actions/transfer.ts` | Copy/move across projects |
| **Velocity analytics** | Complete | `components/velocity/` | Throughput, cycle time, heatmap |
| **Realms (workspaces)** | Complete | `components/workspace/` | Full CRUD + invites + scoped visibility |
| **Realm invites** | Complete | `lib/data/workspaces.ts`, `app/invite/realm/[token]/page.tsx` | 7-day token expiry |
| **Realm REST API** | Complete | `api/v1/realms/` (6 routes) | Full CRUD |
| **Sidebar navigation** | Complete | `components/sidebar/AppSidebar.tsx`, `KairosSidebarSection.tsx` | Kairos pill added between realm list and create actions |
| **Kairos sidebar pill** | Complete | `components/sidebar/KairosSidebarSection.tsx` | Glowing pill with Setup + Guide buttons (KairosLearnModal) |
| **Kairos — 2D graph** | Complete | `components/kairos/Kairos2D.tsx`, `scene/EdgeLayer2D.tsx`, `scene/PlanetCloud2D.tsx`, `scene/OrthoControls2D.tsx`, `scene/Backdrop2D.tsx` | WebGL via @react-three/fiber + d3-force-3d. Edges render after first tick (string→object guard) |
| **Kairos — 3D graph** | Complete | `components/kairos/Kairos3D.tsx`, `scene/Planet.tsx`, `scene/PlanetCloud.tsx` | Gradient glass ball planets |
| **Kairos — shell + layout** | Complete | `components/kairos/KairosShell.tsx`, `app/kairos/layout.tsx`, `app/kairos/page.tsx` | Server-side workspace load |
| **Kairos — memory side panel** | Complete | `components/kairos/MemorySidePanel.tsx` | Title + colour pills + execSummary bullets + collapsed body |
| **Kairos — color modes** | Complete | `components/kairos/nodeColor.ts` | Dominion / type / realm / recency |
| **Kairos — legend** | Complete | `components/kairos/KairosLegend.tsx` | Node color legend |
| **Kairos — Setup + Guide modal** | Complete | `components/ui/kairos/KairosLearnModal.tsx`, `KairosSetupContent.tsx`, `KairosGuideContent.tsx` | Two-tab modal |
| **Kairos — memory data hook** | Complete | `components/kairos/useKairosData.ts` | Fetches graph nodes + edges |
| **Dominions** | Complete | `lib/data/dominions.ts`, `lib/actions/dominions.ts`, `api/[transport]/tools/dominions.ts` | Top-level grouping above Project. 10 MCP tools. **REST not yet implemented** |
| **Memory schema — aiTitle + execSummary** | Complete | `lib/db/schema.ts`, migration 0015 | `aiTitle` varchar(120), `execSummary` jsonb default [] |
| **Memory REST API** | Complete | `api/v1/memories/` (9 routes) | Full CRUD + search + FTS context + link graph + export + needs-summary |
| **Memory MCP tools** | Complete | `api/[transport]/tools/memories.ts` | 7 tools |
| **Hide toggle** | Complete | `stores/sidebarStore.ts` | Per-project and per-realm (persisted) |
| **Project CRUD** | Complete | `components/project/` | Create / edit / delete / realm assignment |
| **Project views (Space/Tree/Grid)** | Complete | `SpaceView.tsx`, `TreeView.tsx`, `GridView.tsx` | — |
| **Theming (151 presets)** | Complete | `packages/shared/src/config/themes/`, `stores/themeStore.ts` | 17 categories |
| **Visual effects (13)** | Complete | `components/effects/` | Starfield, sakura, snowfall, matrix, storm, aurora |
| **Celebrations** | Complete | `components/celebrations/CelebrationEngine.tsx` | 6 categories |
| **Settings modal** | Complete | `ui/settings/SettingsModal.tsx` | 7 tabs |
| **Share / invite** | Complete | `board/ShareModal.tsx`, `app/invite/[token]/page.tsx`, `app/share/[token]/` | Email invite + read-only snapshot |
| **Export** | Complete | `api/export/route.ts` | Full JSON export |
| **Auth (OAuth + magic link)** | Complete | `lib/auth.ts` | Google, GitHub (optional), Resend |
| **API keys** | Complete | `api/v1/api-keys/`, `lib/data/api-keys.ts` | Create/revoke |
| **MCP server** | Complete | `api/[transport]/route.ts`, `tools/` (13 modules) | 76 tools |
| **Beta terms gate** | Complete | `app/beta-terms/` | Terms acceptance |
| **Undo system** | Complete | `lib/store/undoStore.ts` | 20-entry stack |
| **Real-time sync (Pusher + polling)** | Complete | `lib/pusher.ts`, `lib/realtime/index.ts` | ~1s push, 30s polling fallback |
| **PWA** | Complete | `public/manifest.json`, `public/sw.js`, `public/offline.html` | Precaching + offline fallback |
| **Capacitor (mobile shell)** | Configured | `apps/web/capacitor.config.ts` | iOS/Android wiring; no build pipeline |
| **Virtual scrolling** | Complete | `components/board/VirtualizedTaskList.tsx` | TanStack Virtual, 15+ card threshold |
| **Optimistic UI** | Complete | `app/project/[id]/useBoardHandlers.ts` | Snapshot-rollback on all mutations |
| **Activity feed UI** | Not Started | DB table populated, no frontend | — |
| **Dominion REST API** | Not Started | MCP tools exist | No `/api/v1/dominions/` yet |
| **Desktop (Tauri)** | Parked | `apps/desktop/` | Deferred post-beta |

---

## 6. STATE MANAGEMENT

All stores use Zustand v5.

| Store | Manages | File | Persistence |
|---|---|---|---|
| `useBoardStore` | Columns, tasks, labels, deps, checklists, selection, filters | `apps/web/src/lib/store/boardStore.ts` | `zustand/persist` |
| `useCanvasStore` | Canvas nodes, edges, selection | `apps/web/src/lib/store/canvasStore.ts` | `zustand/persist` |
| `useGanttStore` | Gantt tasks, rows, views, time scale | `apps/web/src/lib/store/ganttStore.ts` | `zustand/persist` |
| `useUndoStore` | Undo stack (max 20) | `apps/web/src/lib/store/undoStore.ts` | In-memory |
| `useThemeStore` | Theme, colors, glow/glass/saturation, fonts, effects, shortcuts | `apps/web/src/stores/themeStore.ts` | Hydrates from DB |
| `useSidebarStore` | Collapsed, active realm, hidden ids | `apps/web/src/stores/sidebarStore.ts` | `zustand/persist` |
| `useKairosStore` | Selected memory id, refresh signal | `apps/web/src/stores/kairosStore.ts` | In-memory (page-scoped) |

---

## 7. INTEGRATIONS

| Service | Purpose | Status |
|---|---|---|
| **Neon (PostgreSQL)** | Primary DB | Active |
| **NextAuth v5** | Auth | Active |
| **Google OAuth** | Sign-in | Active |
| **GitHub OAuth** | Sign-in | Optional |
| **Resend** | Email | Active |
| **Vercel** | Hosting | Active |
| **MCP Protocol** | AI tools | Active (76 tools) |
| **ReactFlow (@xyflow)** | Canvas | Active |
| **@react-three/fiber** | Kairos WebGL | Active |
| **d3-force-3d** | Kairos sim | Active |
| **@dnd-kit** | DnD | Active |
| **Pusher Channels** | Real-time | Active |
| **@tanstack/react-virtual** | Virtual scroll | Active |
| **Tauri** | Desktop wrapper | Scaffold |

---

## 8. KNOWN GAPS & TECHNICAL DEBT

| Issue | Severity | Details |
|---|---|---|
| Dominion REST API missing | Medium | 10 MCP tools exist; no `/api/v1/dominions/` routes |
| MCP lacks canvas tools | Medium | REST has canvas endpoints, MCP does not |
| Gantt mutations don't fire Pusher / boardVersion | Low | `createGanttTask` / `createRow` / `createGanttView` don't call `touchProject` |
| execSummary backfill incomplete | Low | Pre-migration-0015 memories have empty execSummary. Callers loop `list_memories_needing_summary`; no automated cron |
| Activity feed has no UI | Low | Table populated, no frontend |
| Desktop app is scaffold only | Low | Tauri config exists, no integration |
| Test coverage | Low | ~9 test files; no component tests |

---

## 9. RECENT CHANGES

### 2026-05-23 — Kairos rebrand + Dominions + memory schema

1. **Kairos rebrand** — `app/brain/` → `app/kairos/`, `components/brain/` → `components/kairos/`, `docs/brain/` → `docs/kairos/`. Route is now `/kairos`.
2. **Kairos 2D WebGL rebuild** — `Kairos2D.tsx` on @react-three/fiber + d3-force-3d, with orthographic controls (`OrthoControls2D`), `PlanetCloud2D`, `EdgeLayer2D` (fixed: string→object guard so edges render after first tick), `Backdrop2D`. `KairosShell.tsx` added.
3. **Kairos planet polish** — `scene/Planet.tsx` iterates v8 → v10: matte gradient → galaxy-in-glass → clean gradient glass ball.
4. **Dominions** — new top-level grouping above Project. Tables: `dominions`, `dominion_repos` (migration 0016). `projects.dominion_id` + `memories.dominion_id` FKs added. 10 MCP tools including `bulk_assign_projects_to_dominion`. REST: not yet implemented.
5. **Memory schema — aiTitle + execSummary** — migration 0015 adds `ai_title varchar(120)` and `exec_summary jsonb default []`. MCP `create_memory` + `update_memory` accept and return both. Side panel shows bullets front-of-house.
6. **`list_memories_needing_summary`** — 7th memory MCP tool. REST mirror at `GET /api/v1/memories/needs-summary`. Parity test updated.
7. **Kairos sidebar integration** — `KairosSidebarSection.tsx` + extracted `SidebarCreateActions.tsx`. Pill links to `/kairos`, Setup + Guide open `KairosLearnModal`.
8. **kairosStore** — new in-memory Zustand store (`stores/kairosStore.ts`).
9. **MCP tool count** — 63 → 76 (+7 memory, +10 dominion).

### 2026-04-17 — checklist atomic ordering + board perf

1. `lib/data/checklist.ts` — `db.transaction()` with `MAX(orderIndex)` for atomic ordering.
2. `VirtualizedTaskList.tsx` — `ESTIMATED_CARD_HEIGHT` 90→160; opacity gate prevents stagger flash.
3. `TaskBoard.tsx` — `tasksByColumn` Map pre-computed; module-level `EMPTY_TASKS`.

### 2026-04-16 — Gantt MCP/REST parity

1. Gantt MCP: 52 → 63 tools (+11 for delete/batch/rows/views/reorder).
2. Gantt REST: 7 new route files.
3. `gantt-parity.test.ts` — 53-assertion static parity lock.
