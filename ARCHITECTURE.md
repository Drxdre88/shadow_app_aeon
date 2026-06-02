# ARCHITECTURE.md

Last updated: 2026-06-02

---

## 1. OVERVIEW

Aeon is a project management web application built as an npm workspaces monorepo (`apps/web` + `apps/desktop` + `apps/kairos-worker` + `packages/shared`). The stack is **Next.js 16** (App Router, **React Compiler**, **Partial Prerendering**) with **TypeScript**, **PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand** (scoped selectors) for client state, **NextAuth v5** for authentication, **Tailwind CSS** for styling, and **Framer Motion** for animations. Surfaces: kanban board (virtual scrolling via TanStack Virtual), Gantt, canvas (whiteboard), trophy/vault archive, velocity analytics, 151 theme presets, an MCP tool server for AI integration, **Pusher** real-time sync (30s polling fallback), a **PWA** (manifest + service worker + offline fallback), a **Capacitor** mobile shell, and a Tauri desktop shell (scaffold, parked).

**Kairos** is the AI memory layer — a WebGL graph of user-scoped memories anchored to realms, projects, tasks, and a top-level grouping called **Dominions**. Memories carry `aiTitle` (1–6 word AI title), `execSummary` (5–10 bullet array), and a Phase 2 `streamClass` axis (`agentic` / `execution` / `idea` / `reflection` / `archetype` / `cortex`) used by the synthesis layer for weighting. The Kairos workflow spans: (a) **auto-capture** of board/project events, (b) a **Briefer** cron writing one daily advisory per active Dominion (live board-aware as of Phase 2 A3), (c) an **ambient advisory feed**, (d) a **Spawn primitive** for out-of-process Claude/Codex sessions, (e) nightly **archetype synthesis** (3–7 master nodes per Dominion) feeding (f) a per-Dominion **living cortex document**, (g) a **kairos_reflect** MCP tool for owner reflections, and (h) a right-side **chat Visor** for talking to Kairos anchored to one Dominion at a time.

---

## 2. DIRECTORY MAP

```
apps/web/                          -- Next.js web application
  src/app/                         -- App Router pages and API routes
  src/app/api/v1/                  -- REST API (session + API key auth)
  src/app/api/v1/memories/         -- Memory REST surface (incl. capture, needs-summary)
  src/app/api/v1/ai/               -- BYOK credentials + preferences (admin-gated)
  src/app/api/v1/sessions/         -- Agent session lifecycle (spawn, events, kill)
  src/app/api/[transport]/         -- MCP server (Bearer token auth, 94 tools)
  src/app/api/cron/                -- Briefer + project-snapshot cron (CRON_SECRET)
  src/app/kairos/                  -- Kairos memory graph page
  src/app/notes/                   -- Notes bento page
  src/app/settings/ai/             -- BYOK provider key + tier routing page
  src/components/board/            -- Kanban board, task edit, DnD, filters, virtual scrolling
  src/components/canvas/           -- Canvas/whiteboard (ReactFlow)
  src/components/gantt/            -- Gantt chart components
  src/components/hyperspace/       -- Daily Briefing card + EOD button + Capture FAB + QuickCapture
  src/components/kairos/           -- Kairos graph + advisory feed + live sessions + create/edit Dominion
  src/components/kairos/scene/     -- WebGL scene primitives (2D + 3D variants)
  src/components/notes/            -- Notes bento grid + auto-captures strip + promote-to-card
  src/components/sidebar/          -- AppSidebar + SidebarHome + SidebarBottom + Kairos/Realm sections
  src/components/trophy/           -- Trophy room / vault archive
  src/components/velocity/         -- Velocity analytics charts
  src/components/board/            -- TaskAssigneeOverlay (M hotkey) and family
  src/components/ui/               -- Settings, help, command palette, toast, AnchoredPopover
  src/lib/actions/                 -- Server actions (mutations)
  src/lib/data/                    -- Pure data-layer queries
  src/lib/ai/                      -- BYOK router, provider envelope, route-task, crypto
  src/lib/kairos/                  -- briefer, auto-capture, project-snapshot, spawn
  src/lib/store/                   -- Zustand stores (board, canvas, gantt, undo)
  src/stores/                      -- Zustand stores (theme, sidebar, kairos)
apps/kairos-worker/                -- Standalone Node HTTP server (spawn / kill / health)
apps/desktop/                      -- Tauri desktop shell (scaffold)
packages/shared/                   -- Shared types, theme presets, filter utils
  src/config/themes/               -- 17 theme categories, 151 presets
  src/types/                       -- Board, canvas, gantt, celebration types
  src/utils/                       -- boardFilters (shared with web)
  src/config/defaults.ts           -- Default preferences + shortcuts
```

---

## 3. DATA LAYER

**ORM:** Drizzle ORM with `@neondatabase/serverless` driver.
**Schema file:** `apps/web/src/lib/db/schema.ts`
**Migrations:** `apps/web/drizzle/` — through `0021_memory_stream_class.sql`. Latest eight: `0014_ai_integration`, `0015_kairos_summaries`, `0016_dominion`, `0017_dominion_body`, `0018_engine_policies`, `0019_agent_sessions`, `0020_task_assignees`, `0021_memory_stream_class`.

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | id, email, role, termsAcceptedAt | Auth identity; `role` gates beta + admin-only AI features |
| `accounts` | (provider, providerAccountId) | OAuth tokens (Google, GitHub) |
| `sessions` | sessionToken, userId | NextAuth web sessions |
| `verificationTokens` | (identifier, token) | Magic-link tokens |
| `projects` | id, userId, dominionId, settings, boardVersion | Project; `dominionId` FK added in 0016 |
| `projectMembers` | (projectId, userId), role | Per-project ACL |
| `projectInvites` | token, email, expiresAt | Email-based invitations |
| `workspaceGroups` | id, ownerId, isPersonal, settings | Realms; partial unique index — one personal realm per user |
| `groupMembers` | (groupId, userId), role | Realm membership |
| `projectGroups` | (projectId, groupId), visibility | Project ↔ realm |
| `realmInvites` | token, email, groupId, expiresAt | 7-day realm invites |
| `boardColumns` | id, projectId, orderIndex | Kanban columns |
| `boardTasks` | id, columnId, ganttTaskId, metadata, archivedAt, completedAt | Cards; bidirectional FK to `ganttTasks` |
| `labels` / `taskLabels` | projectId, color / (taskId, labelId) | Tags and joins |
| `taskDependencies` | (blockerTaskId, blockedTaskId) | Blocker/blocked edges |
| `checklistItems` | id, taskId, state, groupName, orderIndex | Tri-state grouped checklists |
| `ganttViews` / `rows` / `ganttTasks` | id, projectId, ... | Saved views, swimlanes, bars |
| `canvasNodes` / `canvasEdges` | id, projectId, ... | Whiteboard |
| `taskVault` | id, originalTaskId, labelSnapshot, checklistSnapshot | Archived snapshot store |
| `taskComments` | id, taskId, userId, content | Threaded comments |
| `boardSnapshots` | token, snapshot, expiresAt | Public share links |
| `activityEvents` | entityType, action, actorType ∈ {user, agent}, metadata | Audit trail; `actorType` extended for agents |
| `userPreferences` | userId, preferences (jsonb) | Theme + UI settings blob |
| `apiKeys` | keyPrefix, keyHash, revokedAt | REST/MCP keys |
| `userContacts` | userId, contactEmail | Invite autocomplete |
| `mobileLoginTokens` / `mobileSessions` | tokenHash, expiresAt | Mobile magic-link + bearer |
| `memories` | userId, dominionId, realmId, projectId, taskId, aiTitle, execSummary jsonb, type, streamClass, source, tags, pinned, archivedAt | Kairos memory nodes. `streamClass` (Phase 2 A1) classifies layer: `agentic` / `execution` / `idea` / `reflection` / `archetype` / `cortex`. FTS via raw-SQL generated `tsvector` + GIN |
| `dominions` | id, userId, name, color, icon, sortOrder, vision, missionLong, archivedAt | Kairos top-level grouping above project; standing context for Briefer |
| `dominionObjectives` | dominionId, title, status, targetDate, sortOrder | Concrete goals; Briefer reads open ones as "what matters" |
| `dominionRepos` | (dominionId, repoSlug) | Repo-slug → Dominion mapping for auto-resolution |
| `userAiCredentials` | userId, provider, ciphertext, iv, authTag, keyHint, revokedAt | AES-256-GCM encrypted BYOK keys; partial unique index — one active key per (userId, provider) |
| `userAiPreferences` | userId, {cheap,standard,heavy}{ProviderId,ModelId} | Three-tier model routing per user |
| `enginePolicies` | userId (nullable=global), taskType, sensitivity, urgency, providerId, modelId, tier, priority | Engine Router rows; falls back to hard-coded `DEFAULT_POLICIES` |
| `agentSessions` | userId, dominionId, engine, repo, branch, goal, prompt, status, workerHost, workerPid, costUsd (numeric(10,4)), memoryId, exitCode | Spawn primitive — AI agent sessions. Phase 2 C1 also stores chat threads here (`engine='kairos-chat'`, `goal` = thread title) |
| `sessionEvents` | sessionId, seq (unique per session), kind, toolName, payload jsonb | Monotonic event timeline; replay-idempotent. Phase 2 C1 also stores chat messages here (`kind='message'`, `payload={role, content, citations?, model?}`) |
| `taskAssignees` | (taskId, userId), assignedBy, assignedAt | Trello-style multi-assign |

**Patterns:** Three-layer invariant — `lib/data/` (pure queries) → `lib/actions/` (auth-guarded server actions) → API surfaces. All mutations call `touchProject()` to bump `boardVersion`. `verifyProjectAccess()` resolves direct membership, ownership, and realm membership in 1–2 queries. Dominion resolution: `memory.dominionId` ?? `project.dominionId` ?? `dominionRepos` via `sourceMetadata.repo` ?? null. Two partial unique indexes (one personal realm per user; one active AI key per user × provider). Forward-referenced FKs (`projects.dominionId`, `memories.dominionId`, `boardTasks ↔ ganttTasks`) avoid Drizzle circular imports.

`lib/data/` modules: `tasks`, `projects`, `columns`, `labels`, `dependencies`, `checklist`, `gantt`, `ganttViews`, `vault`, `canvas`, `comments`, `members`, `workspaces`, `activity`, `preferences`, `api-keys`, `contacts`, `mobile-auth`, `velocity`, `storage`, `bridge`, `memories` (incl. `captureReflection`), `memoriesMarkdown`, `dominions`, `ai-credentials`, `sessions`, `assignees`, `kairos-chat` (Phase 2 C1), `validators`.

---

## 4. API SURFACE

### REST Routes (`/api/v1/`)

Auth: Session cookie OR `Bearer` API key (via `authenticateRequest`). Rate-limited via `withRateLimit`. AI routes carry an extra `role === 'admin'` gate.

Notable additions since 2026-05-23:

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/v1/ai/credentials` | List / upsert BYOK credentials (admin-gated) |
| PATCH / DELETE | `/api/v1/ai/credentials/[id]` | Rename / revoke credential |
| POST | `/api/v1/ai/credentials/test` | Fire a test generation against the key |
| GET / PUT | `/api/v1/ai/preferences` | Read / write per-tier model preferences |
| POST / GET | `/api/v1/sessions` | Spawn / list agent sessions |
| GET / PATCH | `/api/v1/sessions/[id]` | Fetch / worker-side status callback |
| POST / GET | `/api/v1/sessions/[id]/events` | Ingest / replay session events |
| POST | `/api/v1/sessions/[id]/kill` | SIGTERM the worker; status → killed |
| POST | `/api/v1/memories/capture` | Idempotent inbound capture (channel + externalId dedup) |
| GET | `/api/v1/memories/needs-summary` | Memories with missing aiTitle / execSummary |
| GET | `/api/v1/projects/resolve` | Repo-slug → project resolution |
| POST | `/api/cron/briefer` | Daily Briefer cron — 07:00 UTC (CRON_SECRET) |
| POST | `/api/cron/project-snapshot` | Nightly snapshot cron — 23:00 UTC (CRON_SECRET) |
| GET | `/api/cron/archetype-synthesis` | Daily archetype synthesis — 02:30 UTC, Phase 2 B1 (CRON_SECRET) |
| GET | `/api/cron/cortex-regen` | Daily Dominion cortex regen — 03:00 UTC, Phase 2 B2 (CRON_SECRET) |
| GET | `/api/cron/memory-compaction` | Weekly substrate count/report — Sun 03:00 UTC, Phase 2 A4 stub (CRON_SECRET) |

Existing memory + board + Gantt + realm + canvas routes preserved.

### MCP Tools (`/api/[transport]/`)

Auth: Bearer (API key or master key). **95 tools** across 15 categories:

| Category | Count | Notes |
|---|---|---|
| projects | 6 | list, get, create, update, delete, summary |
| columns | 5 | list, create, update, delete, reorder |
| tasks | 6 | list, create, update, delete, get_detail, batch_create |
| gantt | 14 | tasks + rows + saved views, full CRUD + batch + reorder |
| labels | 6 | CRUD + add/remove from task |
| checklist | 5 | CRUD + batch_create |
| comments | 4 | CRUD |
| dependencies | 4 | list, add, remove, batch_add |
| analytics | 1 | get_velocity_stats |
| bulk | 1 | setup_board |
| realms | 14 | CRUD + members + invites + projects |
| memories | 7 | create, update, search, link, prepare_context, get_with_neighbours, list_needs_summary |
| **dominions** | **16** | CRUD + vision/objectives + repo mapping + project assignment + bulk assign |
| **sessions** | **5** | spawn_session, list_sessions, get_session, list_session_events, kill_session |
| **reflections** | **1** | kairos_reflect — fire owner reflection into a Dominion (Phase 2 B3) |

**Parity locks:**
- `gantt-parity.test.ts` — locks the Gantt MCP ↔ REST surface.
- `memories-parity.test.ts` — locks the 7 memory MCP tools vs REST routes; enforces shared validators + data functions + `authenticateRequest` per route.
- **Sessions** have matching REST + MCP shapes but no parity test yet — drift risk as the spawn lifecycle grows.

**Intentional surface gaps:**
- Dominions are MCP-only (16 tools, zero REST routes).
- Reflections are MCP-only by design (Phase 1B; web UI button planned for C1+).
- Chat surface uses server actions (no REST or MCP for thread/message read paths — C3 will add `chat_with_kairos` MCP tool).
- AI credentials/preferences are REST-only (admin-restricted operator surface).
- MCP has no canvas tools (REST-only by design).

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
| **Task assignment (Trello-style)** | Complete | `board/TaskAssigneeOverlay.tsx`, `lib/data/assignees.ts` | M-hotkey assignment overlay; no avatar pile on cards yet |
| **Gantt view + saved views** | Complete | `components/gantt/` | Day/week/month scale |
| **Canvas view** | Complete | `components/canvas/CanvasView.tsx` | ReactFlow whiteboard |
| **Trophy / Vault** | Complete | `components/trophy/` | Archived tasks, stats, timeline |
| **Vault archiving (batch)** | Complete | `BatchVaultModal.tsx`, `lib/actions/vault.ts` | `snapshotTaskDataBatch` |
| **Task / column transfer** | Complete | `lib/actions/transfer.ts` | Copy/move across projects |
| **Velocity analytics** | Complete | `components/velocity/` | Throughput, cycle time, heatmap |
| **Realms (workspaces)** | Complete | `components/workspace/` | Full CRUD + invites + scoped visibility |
| **Realm invites** | Complete | `lib/data/workspaces.ts`, `app/invite/realm/[token]/` | 7-day token expiry |
| **Realm REST API** | Complete | `api/v1/realms/` (6 routes) | Full CRUD |
| **Sidebar — Home entry** | Complete | `components/sidebar/SidebarHome.tsx` | Glowing pinned top-of-sidebar link to `/dashboard` |
| **Sidebar — Bottom pill rows** | Complete | `components/sidebar/SidebarBottom.tsx` | Today cluster (Notes, Briefing, Advisories, EOD, Live sessions) over utilities (Changelog, Beta, Help, Stats, Settings) |
| **Sidebar — Kairos pill** | Complete | `components/sidebar/KairosSidebarSection.tsx` | Glowing pill + Setup/Guide |
| **Kairos — 2D graph** | Complete | `components/kairos/Kairos2D.tsx` and `scene/*2D.tsx` | WebGL via @react-three/fiber + d3-force-3d |
| **Kairos — 3D graph** | Complete | `components/kairos/Kairos3D.tsx`, `scene/Planet.tsx`, `scene/PlanetCloud.tsx` | Gradient glass ball planets |
| **Kairos — shell + layout** | Complete | `components/kairos/KairosShell.tsx`, `app/kairos/layout.tsx`, `app/kairos/page.tsx` | Server-side workspace load |
| **Kairos — memory side panel** | Complete | `components/kairos/MemorySidePanel.tsx` | Title + pills + execSummary + body |
| **Kairos — color modes** | Complete | `components/kairos/nodeColor.ts` | Repo (default) / dominion / type / source |
| **Kairos — legend** | Complete | `components/kairos/KairosLegend.tsx` | — |
| **Kairos — Setup + Guide modal** | Complete | `components/ui/kairos/KairosLearnModal.tsx` and tabs | Two-tab modal |
| **Kairos — TrackingRail** | Complete | `components/kairos/TrackingRail.tsx` | Right-side tracker rail |
| **Kairos — auto-capture (board)** | Complete | `lib/kairos/auto-capture.ts` → `captureBoardEvent` | Fire-and-forget from task actions |
| **Kairos — auto-capture (project)** | Complete | `lib/kairos/auto-capture.ts` → `captureProjectEvent` | Fires on project create/update |
| **Kairos — nightly project snapshot** | Complete | `lib/kairos/project-snapshot.ts`, `api/cron/project-snapshot/route.ts` | Open/done/blocked counts + last 5 events per project |
| **Kairos — Briefer cron** | Complete | `lib/kairos/briefer.ts`, `api/cron/briefer/route.ts` | One advisory per active Dominion per day; BYOK-gated; idempotent on `briefer:{date}:{dominionId}` |
| **Kairos — Daily Briefing card** | Complete | `components/hyperspace/DailyBriefingCard.tsx`, `DailyBriefingButton.tsx` | Sidebar popover entrypoint; provider pills; Run-now button; three-state UI (no key / no brief / advisories) |
| **Kairos — EOD Reflection** | Complete | `components/hyperspace/EodReflectionButton.tsx` | Sidebar popover; 3 fields; idempotent per day; day-resets after midnight |
| **Kairos — Advisory feed (sidebar)** | Complete | `components/kairos/AdvisoryFeed.tsx` | Unread count + popover + acknowledge + Kairos deep-link |
| **Kairos — engine router** | Complete | `lib/ai/route-task.ts`, `lib/ai/router.ts`, `lib/ai/provider.ts` | Tier policies; BYOK key resolution; Vercel AI SDK envelope |
| **Kairos — spawn primitive** | Complete | `lib/kairos/spawn.ts`, `lib/actions/sessions.ts`, `lib/data/sessions.ts` | Inserts `agent_sessions` then POSTs to kairos-worker; no-op if `KAIROS_WORKER_URL` unset |
| **Kairos — sessions REST + MCP** | Complete | `api/v1/sessions/*`, `api/[transport]/tools/sessions.ts` | List, get, events, kill |
| **Kairos — Live Sessions button** | Complete | `components/kairos/LiveSessionsButton.tsx` | Pulsing badge + popover + transcript polling |
| **kairos-worker app** | Complete | `apps/kairos-worker/` | Standalone Node HTTP server; `/spawn`, `/kill/:id`, `/health`; shells claude/codex; bearer-auth via `KAIROS_WORKER_SECRET` |
| **Dominions** | Complete | `lib/data/dominions.ts`, `lib/actions/dominions.ts`, `api/[transport]/tools/dominions.ts` | 16 MCP tools; REST not yet implemented |
| **Dominion — Create modal** | Complete | `components/kairos/CreateDominionModal.tsx` | Sidebar action |
| **Dominion — Edit drawer** | Complete | `components/kairos/DominionEditDrawer.tsx` | Inline edit of vision, mission, objectives |
| **Kairos Phase 2 — memory streamClass** | Complete | `lib/db/schema.ts`, migration 0021 | A1: classifier axis (`agentic`/`execution`/`idea`/`reflection`/`archetype`/`cortex`); backfilled 326 of 378 rows |
| **Kairos Phase 2 — 8 Dominions partitioned** | Complete | board state | A2: Swarm, Shadow Lab, AEON, Shadow Apps, STP Dev, STP Asset Trading, STP Spec, STP Quant |
| **Kairos Phase 2 — Briefer live board awareness** | Complete | `lib/data/dominions.ts:inspectDominion`, `lib/kairos/briefer.ts` | A3: morning briefing lists open board cards live; archetype + cortex rows excluded from "recent memories" |
| **Kairos Phase 2 — quality gates doc** | Complete | `docs/kairos/14-quality-gates.md` | A4: operating rules for memory ingress/egress, Dominion graduation |
| **Kairos Phase 2 — archetype generator** | Complete | `lib/kairos/archetypes.ts`, `archetypes-prompt.ts`, `api/cron/archetype-synthesis/route.ts` | B1: nightly per-Dominion BYOK job emits 3–7 master-node memories; transactional archive+insert; idempotent per UTC day |
| **Kairos Phase 2 — Dominion cortex regen** | Complete | `lib/kairos/cortex.ts`, `cortex-prompt.ts`, `api/cron/cortex-regen/route.ts` | B2: one living document per Dominion regenerated nightly; structured payload in metadata, rendered markdown in body; race defense against archetype overrun |
| **Kairos Phase 2 — kairos_reflect MCP tool** | Complete | `app/api/[transport]/tools/reflections.ts`, `lib/data/memories.ts:captureReflection` | B3: one-shot owner reflection capture, anchored to a Dominion; bypasses createMemorySchema to lock streamClass='reflection' |
| **Kairos Phase 2 — memory-compaction cron stub** | Complete | `api/cron/memory-compaction/route.ts` | A4 stub; Phase 1B+ will absorb old execution-stream memories into archetypes |
| **Kairos Phase 2 — chat Visor (C1)** | Complete | `components/kairos/KairosVisor.tsx`, `KairosVisorToggle.tsx`, `lib/actions/kairos-chat.ts`, `lib/data/kairos-chat.ts`, `lib/kairos/chat-prompt.ts`, `stores/kairosVisorStore.ts` | Right-side slide-out, anchored per Dominion; reuses `agent_sessions` + `session_events` (no schema change); row-lock on parent agent_sessions serialises message seq; orphan-user-message retry path on AI failure |
| **Kairos Phase 2 — shared prompt utils** | Complete | `lib/kairos/_prompt-utils.ts` | Hoisted `neutraliseFences` + `extractJsonBlock` + `todayIso` after horsemen flagged 5 duplicate sites |
| **BYOK AI integration** | Complete | `lib/ai/` (router, providers, crypto, route-task, provider) | Three tiers; Anthropic + OpenAI + Google via Vercel AI SDK; AES-256-GCM keys |
| **BYOK — settings page** | Complete | `app/settings/ai/page.tsx`, `BYOKEntryScreen.tsx`, `AiSettingsClient.tsx`, `ProviderCard.tsx`, `TierRoutingPanel.tsx` | Admin-gated; provider-tinted glass UI; reveal toggle; test → inline result chip; rotate label |
| **BYOK — REST API** | Complete | `api/v1/ai/credentials/*`, `api/v1/ai/preferences/*` | Admin-gated CRUD |
| **Memory schema — aiTitle + execSummary** | Complete | `lib/db/schema.ts`, migration 0015 | `aiTitle` varchar(120), `execSummary` jsonb default [] |
| **Memory REST API** | Complete | `api/v1/memories/*` | Full CRUD + search + FTS context + link graph + export + capture + needs-summary |
| **Memory MCP tools** | Complete | `api/[transport]/tools/memories.ts` | 7 tools |
| **Quick Capture overlay + FAB** | Complete | `components/hyperspace/QuickCaptureOverlay.tsx`, `CaptureFab.tsx` | Floating quick-memory capture |
| **Notes bento page** | Complete | `app/notes/`, `components/notes/NotesView.tsx`, `BentoGrid.tsx`, `NoteCard.tsx` | `/notes` route |
| **Notes — neighbours panel + today's auto-captures** | Complete | `NotesView.tsx`, `TodaysAutoCaptures.tsx` | Side panel re-seeds on linked memory; today's strip |
| **Notes — Promote to Card** | Complete | `PromoteToCardModal.tsx` | Memory → board task |
| **AnchoredPopover** | Complete | `components/ui/AnchoredPopover.tsx` | Portal-anchored popover with flip-when-near-top fallback + Esc close |
| **Hide toggle** | Complete | `stores/sidebarStore.ts` | Per-project and per-realm (persisted) |
| **Project CRUD** | Complete | `components/project/` | Create / edit / delete / realm assignment |
| **Project views (Space/Tree/Grid)** | Complete | `SpaceView.tsx`, `TreeView.tsx`, `GridView.tsx` | — |
| **Theming (151 presets)** | Complete | `packages/shared/src/config/themes/`, `stores/themeStore.ts` | 17 categories |
| **Visual effects (13)** | Complete | `components/effects/` | Starfield, sakura, snowfall, matrix, storm, aurora |
| **Celebrations** | Complete | `components/celebrations/CelebrationEngine.tsx` | 6 categories |
| **Settings modal** | Complete | `ui/settings/SettingsModal.tsx` | 8 tabs (AI tab added) |
| **Share / invite** | Complete | `board/ShareModal.tsx`, `app/invite/[token]/`, `app/share/[token]/` | Email invite + read-only snapshot |
| **Export** | Complete | `api/export/route.ts` | Full JSON export |
| **Auth (OAuth + magic link)** | Complete | `lib/auth.ts` | Google, GitHub (optional), Resend |
| **API keys** | Complete | `api/v1/api-keys/`, `lib/data/api-keys.ts` | Create/revoke |
| **MCP server** | Complete | `api/[transport]/route.ts`, `tools/*` (14 categories) | 94 tools |
| **Beta terms gate** | Complete | `app/beta-terms/` | Terms acceptance |
| **Undo system** | Complete | `lib/store/undoStore.ts` | 20-entry stack |
| **Real-time sync (Pusher + polling)** | Complete | `lib/pusher.ts`, `lib/realtime/index.ts` | ~1s push, 30s polling fallback |
| **PWA** | Complete | `public/manifest.json`, `public/sw.js`, `public/offline.html` | Precaching + offline fallback |
| **Capacitor (mobile shell)** | Configured | `apps/web/capacitor.config.ts` | iOS/Android wiring; no build pipeline |
| **Virtual scrolling** | Complete | `components/board/VirtualizedTaskList.tsx` | TanStack Virtual, 15+ card threshold |
| **Optimistic UI** | Complete | `app/project/[id]/useBoardHandlers.ts` | Snapshot-rollback on all mutations |
| **Activity feed UI** | Not Started | DB populated, no frontend | — |
| **Dominion REST API** | Not Started | MCP tools exist | No `/api/v1/dominions/` yet |
| **Avatar pile on task cards** | Not Started | `SortableTaskCard` has no assignee field | Picker works, no card visual |
| **Desktop (Tauri)** | Parked | `apps/desktop/` | Deferred post-beta |

---

## 6. STATE MANAGEMENT

All stores use Zustand v5.

| Store | Manages | File | Persistence |
|---|---|---|---|
| `useBoardStore` | Columns, tasks, labels, deps, checklists, assignees, selection, filters | `lib/store/boardStore.ts` | `zustand/persist` |
| `useCanvasStore` | Canvas nodes, edges, selection | `lib/store/canvasStore.ts` | `zustand/persist` |
| `useGanttStore` | Gantt tasks, rows, views, time scale | `lib/store/ganttStore.ts` | `zustand/persist` |
| `useUndoStore` | Undo stack (max 20) | `lib/store/undoStore.ts` | In-memory |
| `useThemeStore` | Theme, colors, glow/glass/saturation, fonts, effects, shortcuts | `stores/themeStore.ts` | Hydrates from DB |
| `useSidebarStore` | Collapsed, active realm, hidden ids | `stores/sidebarStore.ts` | `zustand/persist` |
| `useKairosStore` | Selected memory id, refresh signal | `stores/kairosStore.ts` | In-memory (page-scoped) |
| `useKairosVisorStore` | Visor open/closed + active thread id | `stores/kairosVisorStore.ts` | Persists active thread id only (Phase 2 C1) |

---

## 7. INTEGRATIONS

| Service | Purpose | Status |
|---|---|---|
| Neon (PostgreSQL) | Primary DB | Active |
| NextAuth v5 | Auth | Active |
| Google OAuth | Sign-in | Active |
| GitHub OAuth | Sign-in | Optional |
| Resend | Email (magic links) | Active |
| Vercel | Hosting | Active |
| Vercel AI SDK (`ai`) | Vendor-neutral `LanguageModel` envelope | Active |
| `@ai-sdk/anthropic` | Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7 | Active (BYOK) |
| `@ai-sdk/openai` | GPT-5.5 mini / 5.5 / 5.5 Pro | Active (BYOK) |
| `@ai-sdk/google` | Gemini 2.5 Flash / Pro | Active (BYOK) |
| MCP Protocol | AI tool server | Active (94 tools) |
| Pusher Channels | Real-time | Active |
| ReactFlow (@xyflow) | Canvas | Active |
| @react-three/fiber | Kairos WebGL | Active |
| d3-force-3d | Kairos sim | Active |
| @dnd-kit | DnD | Active |
| @tanstack/react-virtual | Virtual scroll | Active |
| `kairos-worker` subprocess | Long-running CLI engine for spawn | Active (separate Node service) |
| Capacitor | Mobile PWA shell | Configured |
| Tauri | Desktop wrapper | Scaffold |

All three AI provider SDKs are consumed exclusively through the Vercel AI SDK adapter. `lib/ai/router.ts` resolves user tier preferences and BYOK keys from DB, instantiates the correct `LanguageModel`, and returns it to `lib/ai/provider.ts` which wraps it in the `AIProvider` interface used by the Briefer, the spawn primitive, and any future Kairos inference path.

---

## 8. KNOWN GAPS & TECHNICAL DEBT

| Issue | Severity | Details |
|---|---|---|
| Dominion REST API missing | Medium | 16 MCP tools exist; no `/api/v1/dominions/` routes — mobile/third-party can't reach dominions |
| `broadcastMemoryEvent` is a no-op stub | Medium | `lib/actions/memories.ts:246` — memory mutations don't push via Pusher; live edits invisible across sessions |
| Orphan running sessions on worker restart | Medium | `agentSessions` in `queued`/`running` aren't reconciled after worker restart; no heartbeat, no cleanup cron |
| Engine router has no CRUD surface | Medium | `enginePolicies` + `route-task.ts` exist; no MCP tools or REST routes to edit policy rows |
| Cost budget tripwires absent | Medium | `agentSessions.costUsd` is recorded; no per-session cap, no daily rollup, no kill switch |
| Sessions parity test missing | Medium | REST + MCP shapes match but no parity lock — drift risk as lifecycle grows |
| Avatar pile missing from task cards | Low | Picker overlay ships; `SortableTaskCard` has no assignee field — zero visual on card face |
| MCP lacks canvas tools | Low | REST has canvas, MCP does not (intentional gap) |
| Gantt mutations don't fire Pusher / boardVersion | Low | `createGanttTask` / `createRow` / `createGanttView` don't call `touchProject` |
| Activity feed has no UI | Low | Table populated, no standalone feed page |
| Desktop app scaffold only | Low | Tauri config, no integration |
| Test coverage thin | Low | 21 test files (1622 tests) — no component/E2E tests |
| Inbound channel adapters absent | Low | Schema allows `'webhook'` source; no `/api/webhooks/slack`, `/teams`, `/github` routes |
| Memory titles backfill not automated | Low | `list_memories_needing_summary` + REST endpoint exist; no cron sweep, manual invocation only |
| Archetype + cortex cron concurrency | Medium | TOCTOU on `alreadyRanToday` + soft-archive + insert; horsemen flagged on B1/B2. Fix: postgres advisory lock per `(userId, dominionId)`. Card in PBI Queue |
| memories.ts past 500-line size standard | Medium | 1178 lines after B3's `captureReflection`. Card in PBI Queue: split into `core` / `capture` / `graph` / `context` |
| Chat assistant Markdown rendered as text | Medium | C1 ships plain-text rendering; system prompt asks for Markdown. Card in PBI Queue: add react-markdown + sanitiser |
| Cross-user cron snapshot leak | Medium | 5 memories from other beta users captured into owner's memory table by `project-snapshot`. Documented in `docs/kairos/14-quality-gates.md` §3 |
| Cron `isAuthorized` copied 5 times | Low | Briefer, snapshot, archetype-synthesis, cortex-regen, memory-compaction all redefine the same auth helper. Card in PBI Queue: hoist to `lib/cron/auth.ts` |
| Kairos B1/B2/B3 pure helpers untested | Low | Stalker flagged: `deriveReflectionTitle`, `hasArchetypeSignal`, `hasCortexSignal`, `parsePriorCortexPayload`, `alreadyRanToday` SQL contract. Card in PBI Queue |
| Chat Visor lacks focus trap | Low | Dialog has Escape + autofocus + role=dialog but tab leaks to underlying page. Card in PBI Queue |
| chat_with_kairos MCP tool absent | Low | Chat surface is server-action only; planned for Phase 1C C3 — second front door to the same threads |

---

## 9. RECENT CHANGES

### 2026-06-02 — Kairos Phase 2: synthesis layer, reflections, chat surface

1. **Phase 1A (memory shape)** — `streamClass` column on memories (migration 0021) + cascade backfill of 326/378 rows. 8 Dominions partitioned (Swarm / Shadow Lab / AEON / Shadow Apps / STP Dev / STP Asset Trading / STP Spec / STP Quant); 370/378 memories resolved into clusters. Briefer reframed: reads live board cards via `inspectDominion` instead of stale board-import memories. `docs/kairos/14-quality-gates.md` documents memory ingress/egress rules; `memory-compaction` cron scaffolded (count-only stub).
2. **Phase 1B (synthesis)** — **B1**: nightly **archetype generator** emits 3–7 master-node memories per Dominion via BYOK at heavy tier (02:30 UTC). Transactional archive+insert; fence-injection defense; idempotent per UTC day. **B2**: nightly **Dominion cortex regen** writes one living document per Dominion (03:00 UTC), structured payload in metadata + rendered markdown in body, used as system-prompt prefix for chat. Cross-job race defense — cortex bails if activity exists but archetypes haven't synthesised today. **B3**: `kairos_reflect` **MCP tool** for owner reflections — bypasses createMemorySchema to lock `streamClass='reflection'` as a contract.
3. **Phase 1C C1 (chat surface)** — right-side slide-out **chat Visor** anchored per Dominion. Reuses `agent_sessions` + `session_events` tables (no schema change): thread = one agent_sessions row with `engine='kairos-chat'`, message = one session_events row with `kind='message'`. Row-lock on parent agent_sessions serialises message seq; orphan-user-message retry skips dup append on resend. Visor has `role=dialog`, Escape close, autofocus, .catch on all .then chains. Wired into `/kairos`, `/notes`, `/settings/ai` layouts via floating sparkles button.
4. **Cron schedule** (`vercel.json`) — full daily cycle now wired: snapshot 23:00 → archetypes 02:30 → cortex 03:00 → briefer 07:00, plus weekly compaction Sunday 03:00.
5. **Horsemen pass on B1+B2+B3** — applied 4 high fixes: Briefer "recent memories" now excludes archetype + cortex rows (recursive context-collapse prevention); cortex race defense; MCP `create_memory` enum synced with canonical `validators.memoryTypeSchema` (drift caught); hoisted `neutraliseFences` + `extractJsonBlock` + `todayIso` to `lib/kairos/_prompt-utils.ts` (duplication across 5 sites).
6. **Tests** — 1584 → 1622 (+38). New: `archetypes.test.ts` (16), `cortex.test.ts` (16), `chat-prompt.test.ts` (6).
7. **PBI Queue follow-ups (8 cards)** — TOCTOU advisory lock (archetypes+cortex), split memories.ts, extract cron `isAuthorized`, extract+test pure helpers, render chat Markdown, add focus trap, cross-user snapshot leak audit, `chat_with_kairos` MCP tool.

### 2026-05-30 — Kairos companion: BYOK, briefer, spawn, sidebar overhaul, horsemen pass

1. **BYOK AI integration** — three-tier model routing (cheap / standard / heavy) over user-supplied keys for Anthropic, OpenAI, Google. AES-256-GCM at rest, admin-gated `/settings/ai` with provider-tinted glass UI (`ProviderCard`, `TierRoutingPanel`), reveal toggle, inline test result chip. REST API at `/api/v1/ai/credentials` + `/preferences`. Migrations 0014, 0018.
2. **Kairos Phase 1** — memory taxonomy, capture, Dominion body, engine router, Briefer cron writing one daily advisory per active Dominion. `lib/ai/router.ts` + `route-task.ts` + `provider.ts` over Vercel AI SDK envelope.
3. **Kairos Phase 2** — auto-capture (board + project events), nightly project snapshot, ambient advisory feed in the sidebar (unread badge, acknowledge, Kairos deep-link).
4. **Kairos Phase 3 — Spawn** — `agent_sessions` + `session_events` tables (migration 0019). `lib/kairos/spawn.ts` dispatches to a new out-of-process `apps/kairos-worker/` Node HTTP service that shells Claude Code / Codex CLIs. REST + MCP CRUD; Live Sessions button with transcript polling.
5. **Dominions** — top-level grouping above projects. Migrations 0016 + 0017 add `dominions`, `dominionObjectives`, `dominionRepos`, plus `dominionId` FKs on `projects` and `memories`. 16 MCP tools; Create modal + Edit drawer. REST not yet implemented.
6. **Task assignees** — migration 0020 + `lib/data/assignees.ts` + `TaskAssigneeOverlay` (M hotkey). Multi-assign per task; picker overlays the card on M. Avatar pile on card face not yet built.
7. **Daily Briefing + EOD Reflection → sidebar popovers** — removed auto-pinned dashboard cards; both now live behind Sun/Moon icons in the sidebar via a shared `AnchoredPopover` (flip-when-near-top, Esc close). Daily Briefing card has three explicit states (no key / key-no-brief / advisories) with provider pills in the header.
8. **Sidebar Home button** — glowing pinned entry at the top of every sidebar; replaces ad-hoc "← Dashboard" arrows. Top row = today (Notes / Briefing / Advisories / EOD / Live sessions); bottom row = utilities (Changelog / Beta / Help / Stats / Settings).
9. **Notes bento page (`/notes`)** — bento grid of memories with today's auto-captures strip, neighbours panel that re-seeds on linked memory, Promote-to-Card flow.
10. **Modal z-index fix** — Help / Stats / Settings modals bumped from `z-50` to `z-[200]` so Kairos 3D node labels (drei `Html zIndexRange={[100,0]}`) no longer bleed over them. Same fix prior commit applied to changelog + features.
11. **Layout shells** — `/notes` and `/settings/ai` now wrap in the standard `KairosShell` sidebar layout.
12. **Architecture extractions (horsemen pass)** — `AiSettingsClient` 532→231 lines (`ProviderCard`, `TierRoutingPanel`); `AppSidebar` 523→298 lines (`SidebarHome`, `SidebarBottom`); shared `lib/ai/providers-ui.ts` (PROVIDER_UI, PROVIDER_TINT, PROVIDER_LABEL); `AnchoredPopover` extracted.
13. **Tests** — 1576 → 1584. New `ai-credentials.test.ts` locks the `requireAuth` (not `requireAiAccess`) policy on `hasAiCredentials` and the 5 branches of `presenceFor`.
14. **Bug fixes** — EOD reflection's "already today" flag now invalidates when the captured day changes; Daily Briefing cache type-guards parsed entries and removes corrupt ones; `presenceFor` adds ORDER BY for deterministic active-provider fallback.

### 2026-05-23 — Kairos rebrand + Dominions + memory schema

1. `app/brain/` → `app/kairos/`, `components/brain/` → `components/kairos/`, `docs/brain/` → `docs/kairos/`.
2. Kairos 2D WebGL rebuild on @react-three/fiber + d3-force-3d (`OrthoControls2D`, `PlanetCloud2D`, `EdgeLayer2D`, `Backdrop2D`).
3. Kairos planet polish — matte gradient → galaxy-in-glass → clean gradient glass ball.
4. Dominions table family added; `projects.dominionId` + `memories.dominionId` FKs.
5. Memory schema — `aiTitle` + `execSummary` (migration 0015); MCP `create_memory` / `update_memory` accept and return both.
6. `list_memories_needing_summary` MCP tool + REST mirror at `/api/v1/memories/needs-summary`.

### 2026-04-17 — checklist atomic ordering + board perf

1. `lib/data/checklist.ts` — `db.transaction()` with `MAX(orderIndex)` for atomic ordering.
2. `VirtualizedTaskList.tsx` — `ESTIMATED_CARD_HEIGHT` 90→160; opacity gate.
3. `TaskBoard.tsx` — `tasksByColumn` Map pre-computed.

### 2026-04-16 — Gantt MCP/REST parity

1. Gantt MCP: 52 → 63 tools (+11).
2. Gantt REST: 7 new route files.
3. `gantt-parity.test.ts` — 53-assertion static parity lock.
