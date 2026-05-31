# Changelog

All notable changes to **Aeon** are documented here. Closed beta — versions track milestone drops rather than strict semver.

## Legend — Area pills

Each section tags its **domain** (orthogonal to Added/Changed/Fixed):

- `BOARD` — kanban surface (columns, cards, DnD, filters, virtual scroll)
- `GANTT` — timeline view, swim-lane rows, saved views
- `CANVAS` — freeform whiteboard (ReactFlow)
- `KAIROS` — memory graph (2D + 3D WebGL, side panel, sidebar pill)
- `DOMINION` — top-level grouping above project (memories + projects + repos)
- `REALM` — workspace groups, invites, member roles, scoped visibility
- `AUTH` — NextAuth, OAuth providers, sessions, mobile auth
- `MCP` — MCP tool server (76 tools across 13 categories)
- `API` — REST routes under `/api/v1/`
- `DATA` — schema, migrations, Drizzle queries
- `INFRA` — Capacitor, PWA, Pusher, build, deploy
- `DOCS` — `ARCHITECTURE.md`, `VISION.md`, `CLAUDE.md`
- `UI` — sidebar, settings, modals, themes (151 presets), effects

## [0.10.0] — 2026-05-23

> Areas touched: `KAIROS` `DOMINION` `MCP` `API` `DATA` `UI` `DOCS`
> Theme: Kairos K-0 through K-5 complete. 2D WebGL graph with cross-repo connections via Dominions, memory backfill tool, in-app onboarding modal.

### Added — Kairos 2D WebGL graph · `KAIROS` · `UI`
- Orthographic Three.js scene via `@react-three/fiber` + `d3-force-3d`. Orthographic camera controls, planet-cloud node rendering, real edge lines, starfield backdrop.
- Color modes: by **Dominion**, by type, by realm, by recency.
- `MemorySidePanel` renders the AI-cleaned title + execSummary bullets when a node is selected.
- Cross-repo edges now appear automatically when memories share a Dominion.

### Added — Dominions (top-level grouping above project) · `DOMINION` · `DATA` · `MCP`
- New tables `dominions` + `dominion_repos`. `projects.dominion_id` and `memories.dominion_id` foreign keys added.
- Dominion resolves for a memory in this order: explicit `memory.dominion_id` ?? owning `project.dominion_id` ?? `dominion_repos` lookup via `sourceMetadata.repo` ?? Unassigned.
- 10 new MCP tools: CRUD + `add_dominion_repo` / `remove_dominion_repo` / `assign_project_dominion` / `bulk_assign_projects_to_dominion`.
- REST surface for Dominions is **not yet built** — flagged as known gap.

### Added — `list_memories_needing_summary` MCP tool + REST mirror · `MCP` · `API`
- Returns memories with empty `execSummary` (and/or null `aiTitle`) so the caller can backfill them via `update_memory` in a loop.
- REST mirror at `GET /api/v1/memories/needs-summary`.
- Memory parity test now locks 7 MCP tools against 9 REST routes.

### Added — Kairos Setup + Guide modal · `KAIROS` · `UI`
- Glowing pill in the sidebar (between realm list and create actions) opens a two-tab onboarding modal.
- Setup walks new users through MCP configuration; Guide is the usage reference.

### Fixed — 2D edges now render after the first d3-force tick · `KAIROS`
- d3-force mutates `link.source` / `link.target` from string IDs to node refs after the first tick. The renderer was doing `nodeById.get(string)` every frame and the lookup quietly returned undefined. One-line guard added.

### Changed — `ARCHITECTURE.md` and `VISION.md` refreshed · `DOCS`
- MCP tool count bumped 63 → 76. K-0 through K-5 marked complete. K-6 (Dominion REST + bulk-assign UX) and K-7 (BYOK merge) added.

### Migrations required
- `0015_kairos_summaries.sql` — adds `ai_title varchar(120)` and `exec_summary jsonb default []` to `memories`.
- `0016_dominion.sql` — creates `dominions` + `dominion_repos`, adds `dominion_id` to `projects` and `memories`.

## [0.9.0] — 2026-05-22

> Areas touched: `KAIROS` `DATA` `UI` `MCP`
> Theme: Brain → Kairos rebrand, memory display rework, AI-cleaned title + exec summary schema.

### Changed — Brain → Kairos rebrand · `KAIROS` · `UI` · `DOCS`
- All paths and references: `app/brain/` → `app/kairos/`, `components/brain/` → `components/kairos/`, `docs/brain/` → `docs/kairos/`. Route is now `/kairos`.
- Sidebar header animates `AEON : KAIROS` with a pulsing glow when on the Kairos route.

### Added — Memory schema for AI-cleaned display · `DATA` · `MCP`
- `memories.aiTitle` (varchar 120, nullable) — 1–6 word AI-cleaned title for front-of-house display.
- `memories.execSummary` (jsonb default `[]`) — 5–10 bullet array.
- `create_memory` and `update_memory` MCP tools accept and return both fields.
- The Aeon server does **no LLM work** — all summarisation happens at the call site (Claude Code self-cleans, then sends pre-cleaned payload).

### Added — `MemorySidePanel` rework · `KAIROS` · `UI`
- Title + colour pills + execSummary bullets + collapsed body. Graceful empty-state for memories that pre-date the schema.

## [0.8.0] — 2026-04-07

> Areas touched: `BOARD` `GANTT` `INFRA`
> Theme: Phase 3 — real-time sync, virtual scrolling, optimistic UI rollback.

### Added — Pusher real-time sync · `BOARD` · `GANTT` · `INFRA`
- Pusher Channels broadcast every board / column / task / label / dep / checklist / comment mutation.
- ~1s push, 30s polling fallback. Sub-second multi-user sync.
- `boardVersion` bumped on every mutation via `touchProject()`.

### Added — Virtual scrolling on large boards · `BOARD` · `UI`
- TanStack Virtual kicks in at 15+ cards per column.
- `ESTIMATED_CARD_HEIGHT` tuned for the dense-card layout.

### Added — Optimistic UI rollback on every mutation · `BOARD`
- Every board mutation snapshots state, mutates locally, and rolls back if the server rejects.

### Removed — React Native mobile scaffold · `INFRA`
- The `apps/mobile/` Expo scaffold (~680 lines) was deleted after the 03/04 Capacitor pivot. Mobile is now WebView-wrapped over the existing Next.js app.

## [0.7.0] — 2026-04-04

> Areas touched: `UI` `AUTH` `INFRA` `DATA`
> Theme: Phase 2.5 — perf, hardening, glow source, React Compiler, PPR, security fixes.

### Added — React Compiler + PPR · `INFRA`
- React Compiler enabled for automatic memoisation.
- Partial Prerendering on dashboard + board surfaces.

### Changed — Zustand selector audit (22 files) · `UI`
- Audit replaced object selectors with scoped primitive selectors to kill re-renders.

### Added — Glow Source setting · `UI`
- Per-priority glow colour selection. Replaces the older single-glow setting.

### Changed — Checklist UX polish · `BOARD`
- Tri-state checkboxes (todo / doing / done), grouped, sortable. Ref-based commit guards prevent blur-loop overwrites.

### Fixed — Horsemen security pass · `AUTH` · `API`
- Multiple input-validation + scope-elevation paths tightened across realm and project surfaces.

## [0.6.0] — 2026-04-03

> Areas touched: `INFRA` `AUTH`
> Theme: Mobile strategy pivot — React Native → Capacitor. PWA enabled.

### Changed — Mobile strategy: Capacitor over React Native · `INFRA`
- React Native would have required a 3–6 month UI rewrite to reach 50–70% visual fidelity. Capacitor wraps the existing Next.js app as-is.
- Mobile auth backend (`mobile-auth.ts`, session tokens, OAuth) remains valid for Capacitor's bearer-auth needs.

### Added — PWA shell · `INFRA` · `UI`
- `manifest.json`, service worker with precaching, offline fallback page.
- Desktop install via PWA covers ~80% of desktop use cases for free. Tauri scaffold parked.

## [0.5.0] — 2026-04-02

> Areas touched: `REALM` `AUTH` `API` `UI`
> Theme: Phase 1.5 hardening — realm invites, REST API parity, lint cleanup, file splits, server-side loading.

### Added — Realm invites · `REALM` · `AUTH`
- Token-based invite, 7-day expiry, email notification via Resend.
- Realm invite acceptance page at `/invite/realm/[token]`.

### Added — Realm REST API · `REALM` · `API`
- 6 route files under `/api/v1/realms/` — full CRUD + members + projects.

### Changed — Server-side loading · `UI`
- Board and dashboard now SSR. `auth()` calls cached per-request. No more loading spinners on initial render.

### Changed — Lint + file-split cleanup · `UI`
- 46 lint warnings → 9. Multiple god-components split into directories with stable public import paths.

## [0.4.0] — 2026-04-01

> Areas touched: `REALM` `AUTH` `UI`
> Theme: Scoped visibility, ProjectSidebar, access denied page.

### Added — Scoped visibility · `REALM` · `AUTH`
- Per-project-per-realm visibility scoping. Realm members see only what was shared with that realm.

### Added — `ProjectSidebar` · `UI`
- Dedicated board-view sidebar. Frees `AppSidebar` for dashboard nav.

### Added — Access denied page · `AUTH`
- Graceful page for users who land on a project they aren't a member of.

## [0.3.0] — 2026-03-31

> Areas touched: `REALM` · `UI`
> Theme: Flat realm list, killed Personal/Team split.

### Changed — Flat realm list with TEAM badge · `REALM` · `UI`
- Personal and Team workspaces collapsed into one list. TEAM badge replaces the section split.
- Viewport-locked layout — no horizontal scroll on small screens.

### Added — Custom realm icons + 7 colours · `REALM`
- 16 Lucide icon options. 7 base colours that flow through the realm's glow palette.

## [0.2.0] — 2026-03-30

> Areas touched: `MCP` · `REALM` · `UI`
> Theme: Sidebar nav rework, MCP realm tools.

### Added — `AppSidebar` with realm sections · `UI`
- Collapsible sidebar with realm list and member preview.

### Added — MCP realm tools (11) · `MCP` · `REALM`
- CRUD + members (list / invite / remove / update role) + projects (list / add / remove).

## [0.1.0] — 2026-03-24

Initial closed beta · `BOARD` `GANTT` `CANVAS` `DATA` `API`

- Kanban board with full DnD, custom columns, labels, dependencies, checklists.
- Gantt timeline with swim-lane rows and saved views.
- Canvas (ReactFlow whiteboard) with node + edge editing.
- Trophy / Vault archive for completed tasks.
- 151 theme presets across 17 categories.
- MCP server (52 tools at this point) with Bearer auth.
- REST API under `/api/v1/` with session + API key auth.
- NextAuth v5 with Google, GitHub, and Resend magic-link providers.
