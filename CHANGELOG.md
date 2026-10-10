# Changelog

All notable changes to **Aeon** are documented here. Closed beta — versions track milestone drops rather than strict semver.

## Legend — Area pills

Each section tags its **domain** (orthogonal to Added/Changed/Fixed):

- `BOARD` — kanban surface (columns, cards, DnD, filters, virtual scroll)
- `GANTT` — timeline view, swim-lane rows, saved views
- `CANVAS` — freeform whiteboard (ReactFlow)
- `REALM` — workspace groups, invites, member roles, scoped visibility
- `AUTH` — NextAuth, OAuth providers, sessions, mobile auth
- `MCP` — MCP tool server (95 tools across 14 categories)
- `API` — REST routes under `/api/v1/`
- `DATA` — schema, migrations, Drizzle queries
- `INFRA` — Capacitor, PWA, Pusher, build, deploy
- `DOCS` — `ARCHITECTURE.md`, `VISION.md`, `CLAUDE.md`
- `UI` — sidebar, settings, modals, themes (151 presets), effects

## [0.49.0] — 2026-10-07

> Areas touched: `BOARD` `MCP` `API`
> Theme: likely finish dates on cards.

### Added — Likely finish dates on cards · `BOARD` `MCP` `API`
- Cards with a due date or estimate show "Likely Fri 10 Oct" — amber when cutting it close, red when probably late. Hover for the reasoning.

### Fixed · `BOARD`
- No false "changed somewhere else" after "Move all cards" or timeline edits.

## [0.48.0] — 2026-10-06

- Internal improvements.

## [0.47.0] — 2026-10-06

- Internal improvements.

## [0.46.1] — 2026-10-06

> Areas touched: `BOARD`
> Theme: a board that never shows old cards as current.

### Fixed — Stale board after sleep or switching away · `BOARD`
- Coming back to Aeon (window focus, laptop or phone waking, a frozen tab resuming, network back, live connection reconnecting) now re-checks the board and reloads if anything changed. Before, it could keep showing old cards while saying "saved".
- The board remembers the exact version it loaded and reloads whenever it isn't sure, instead of assuming it's current.
- An edit that never cleared the "unsaved" flag (labels, for example) can no longer block refreshes for more than 30 seconds.

## [0.46.0] — 2026-10-06

> Areas touched: `MCP`
> Theme: Connector 2.0 — the AI connector moves to the newest MCP standard.

### Changed — Connector 2.0 · `MCP`
- The AI connector runs on the 2026-07-28 MCP standard (mcp-handler 2.2, MCP SDK v2). Older clients (claude.ai, Claude Code, earlier Copilot) keep working unchanged.
- Newer clients ask before destructive actions ("Delete Task on board …? This can't be undone."); declining changes nothing.
- Slimmer tool sets: add `?profile=board` to the connector link. No profile = all tools, as before.

## [0.45.0] — 2026-10-05

- Internal improvements.

## [0.44.0] — 2026-10-05

- Internal improvements.

## [0.43.0] — 2026-10-04

- Internal improvements.

## [0.42.0] — 2026-10-03

- Internal improvements.

## [0.41.0] — 2026-10-03

- Internal improvements.

## [0.40.0] — 2026-10-03

- Internal improvements.

## [0.39.0] — 2026-10-03

- Internal improvements.

## [0.38.0] — 2026-10-02

- Internal improvements.

## [0.37.0] — 2026-10-02

> Areas touched: `UI` `INFRA` `DOCS`
> Theme: Current models everywhere, and Aeon notices when it falls behind.

### Changed — Opus 5.5 by default · `UI` `INFRA`
- One model list (`packages/shared/src/ai/model-registry.json`) now drives the AI settings. Defaults: Claude Opus 5.5 at high effort for deep work, at medium effort for standard work, and Sonnet 5.5 for quick tasks. OpenAI options are GPT-6 Astra / 6.1 Sol / Luna; Google options are Gemini 3.8 Flash / 3.1 Pro. Older Claude, GPT-5 and Gemini 2.5 models are no longer offered, and anyone who saved one moves to its replacement automatically.
- Effort is now sent to the model (Anthropic and OpenAI).

### Fixed — Key tests · `UI`
- Testing an OpenAI or Gemini key now uses that provider's own model instead of a Claude one.

### Added — Aeon living world · `DOCS`
- `npm run freshness` checks model names, help guides, architecture docs, version numbers and package drift (report only). It runs every Monday on GitHub and keeps one tracking issue up to date.

## [0.36.0] — 2026-10-02

- Internal improvements.

## [0.35.0] — 2026-10-02

- Internal improvements.

## [0.34.0] — 2026-10-02

- Internal improvements.

## [0.33.0] — 2026-10-01

- Internal improvements.

## [0.32.0] — 2026-10-01

- Internal improvements.

## [0.31.0] — 2026-10-01

- Internal improvements.

## [0.30.0] — 2026-10-01

- Internal improvements.

## [0.29.0] — 2026-09-21

- Internal improvements.

## [0.28.0] — 2026-09-16

> Areas touched: `API`
> Theme: the API stops answering bad input with 500s.

### Fixed — The API says what went wrong · `API`
- A malformed project id returns 404 instead of a 500.

## [0.27.0] — 2026-09-07

> Areas touched: `BOARD` `REALM` `DATA`
> Theme: people look the way your organisation says they look. Custom initials no longer hide behind a profile photo, every colour is on the table, and a realm can switch the whole team to initials at once.

### Fixed — Custom initials actually show · `BOARD`
- Setting initials for someone who has a profile picture used to change nothing: the photo (often just a single-letter Google avatar) always won. Any styling you set — initials, fill, text colour or shape — now replaces the photo on every board in the realm. People you have not styled keep their photo.
- The edit pencil in the member picker is always visible. It used to appear only on hover, which made it unreachable on a phone.

### Added — Full palette and shapes for member avatars · `BOARD` `DATA`
- Fill colour: the preset dots plus a free colour picker for any hex.
- Text colour: pick any colour for the initials, or leave it white.
- Shape: circle, rounded square or square.
- All of it is per realm — the same person can look different in different realms, and nothing touches their account.

### Added — Realm-wide "initials instead of photos" · `REALM`
- Realm settings → Members has an owner-only switch that shows initials for everyone on every board in the realm. The per-board setting in Sizing still exists and either one being on is enough.

## [0.26.1] — 2026-09-04

> Areas touched: `BOARD` `UI`
> Theme: the phone stops sliding.

### Fixed — Dragging a card right no longer scrolls the whole page off-screen · `BOARD`
- On a phone, dragging a card towards the right edge could scroll the entire page sideways: the board slid to the left half of the screen, empty space opened on the right and a second scrollbar appeared. The page was a few pixels wider than the screen (the toolbar overflowed it) and the drag auto-scroller happily scrolled the window into that gap. Dragging left never showed it because the page was already at zero.
- Three guards now: the page can never scroll sideways, the toolbar scrolls inside itself on narrow screens, and a drag only ever auto-scrolls the board and its columns, never the window.

### Changed — Slim "Add column" on touch · `UI`
- On touch devices the full-width "Add Column" placeholder is now a slim rail with a +, so the last real column is reachable in one drag.

## [0.26.0] — 2026-09-04

> Areas touched: `BOARD` `UI`
> Theme: fusion you can see. Confirm a fusion and the board performs it: the absorbed cards lift, fly in on arcs and detonate into the survivor.

### Added — The fusion effect · `BOARD` · `UI`
- On confirm the modal closes and every absorbed card becomes a glowing ghost that flies along its own arc into the survivor, leaving a light trail. Each arrival fires a shockwave and a burst of that card's colour; after the last one the survivor breathes once and settles. Big fusions fan in as a swarm, staggered but never longer than about two seconds.
- While a chain of fusions lands on the server, a small "Fusing k of N…" pill sits above the survivor.
- With Smooth UI Renders off there is no animation at all — the board simply shows the fused result, as everywhere else in Aeon.

### Changed — Fusion polish from review · `BOARD`
- Only cards you explicitly selected count as fuse sources. Opening a card no longer makes it eligible.
- No limit on how many cards fuse at once.
- Clicking empty board space clears the selection; Ctrl/Cmd, Shift and right-click presses, cards, menus and dialogs leave it alone.
- Restored vault cards append to the first column's own numbering, decided inside the same transaction.

## [0.25.0] — 2026-09-04

> Areas touched: `BOARD` `DATA`
> Theme: fusion, second try. The drag-and-hold gesture never had a middle zone you could hold in — the sortable strategy slides the hovered card away the instant you are over it — so it is gone. Fusion is now an explicit choice: pick the cards, right-click the one that should survive.

### Changed — Card fusion is select-then-fuse, not drag-and-dwell · `BOARD`
- **Ctrl-click** (Cmd on a Mac) toggles a card in the selection, **Shift-click** selects the run from the last-selected card in that column. Selected cards wear the same ring the S key gives. **Esc** clears the selection.
- Right-click any card while others are selected → **Fuse N cards into this one**. The card you right-clicked survives and is renamed; the selected ones are absorbed in selection order — labels, people, dates, size, checklists, dependencies, comments and history merge as before. One Undo (toast or Ctrl+Z) puts every card back.
- On a phone: card **⋯** → Select on each card, then **⋯** → Fuse on the survivor.
- The drag-onto-a-card dwell, its badge and the pinned-slot hit test are removed. Drag-and-drop is exactly what it was before fusion existed: top half places above, bottom half below.

### Fixed — Restoring a card from the Vault made it vanish · `DATA`
- A restored card was written with no column, so the board could never show it while the Vault no longer listed it. Restored cards now land in the board's first column with status todo. The one card lost this way has been reattached by hand.

## [0.24.0] — 2026-09-03

> Areas touched: `BOARD` `GANTT` `UI` `INFRA`
> Theme: the board learns to be touched. Hold-to-move, card fusion, whole-column moves and a members row landed for desktop this morning; this build makes every one of them reachable with a finger, and gives the phone a way to prove which build it is running (this pill).

### Added — Touch-reachable card and column menus · `BOARD` · `UI`
- A **⋯** button on every card and column header on touch devices opens the same menu right-click opens on desktop: Move to…, Priority, Colour, Select, Delete, AI actions; Rename, Colour, Icon, **Move all N cards to…**, transfers, Archive. iOS never fires the right-click event for a long-press and Android hands it to drag first, so menus were unreachable on phones until now.
- Menus clamp to the viewport on both axes and close on an outside tap or Escape.

### Added — Hold-to-move, card fusion, column bulk move, members row · `BOARD`
- Hold a card about half a second (desktop) or long-press, hold still and lift (touch) to arm move mode; tap the destination — top half inserts above, bottom half below, empty space appends. Esc cancels, Ctrl+Z reverts.
- Drag a card onto the middle of another and hold still to **fuse** them: labels, people, dates, size, checklist groups, dependencies, comments and history merge into one card. Undo restores both.
- Column menu → Move all cards to another column, in order, with Undo. Members row in the card editor uses the same picker as the M key.

### Fixed — Phone drag and zoom · `BOARD` · `INFRA`
- Dragging a card between columns while pinch-zoomed out no longer collapses the board to half the screen. A second finger arriving mid-drag was being read as a pinch and stole the drag; pinch now refuses to start while a drag is pending or active, while a deliberate two-finger pinch still works over a crowded board.
- Zen mode: hover a card and press L / G / V / M and the popup acts on that card, anchored to it, instead of the last card hovered on the board.
- Checklist: dragging an item into another group shows a glowing insertion line and drops exactly there; the drag preview follows the finger instead of drifting to the side.

### Changed — Timeline reset asks first · `GANTT`
- Reset shows how many cards leave the timeline and lose dates, stays disabled until you type RESET, and offers Undo.

## [0.23.0] — 2026-07-24

- Internal improvements.

## [0.22.0] — 2026-07-24

> Areas touched: `UI`
> Theme: the MCP help tab lists every tool, and the count can no longer drift.

### Changed — MCP help tab catches up · `UI`
- The MCP help tab now lists all **109** tools across 14 categories (it claimed 36) — and the count is derived from the list, so it can't drift again.

## [0.21.0] — 2026-07-23

- Internal improvements.

## [0.20.0] — 2026-07-20

> Areas touched: `API` `INFRA`
> Theme: production blank errors healed.

### Fixed — Production blank-error incident healed · `API` · `INFRA`
- Under certain workspace states, sign-in, mobile and API routes were returning blank errors. All now return proper responses.

## [0.19.0] — 2026-07-17

> Areas touched: `MCP` `BOARD`
> Theme: self-describing tools and a checklist fix.

### Changed — Self-describing tools · `MCP`
- Every automation tool now carries usage annotations.

### Fixed — Checklist ghost input · `BOARD`
- Phantom "New item" rows no longer appear in checklists.

## [0.18.0] — 2026-07-14

- Internal improvements.

## [0.17.0] — 2026-07-13

> Areas touched: `BOARD` `UI` `DATA`
> Theme: favorite your projects.

### Added — Project favorites · `BOARD` · `UI` · `DATA`
- Star a project from the dashboard or the board header; favorites float to the top.

### Fixed — Image alt text · `UI`
- Images in the board-sharing UI now carry alt text (accessibility gate).

### Migrations required
- `0026_favorite_projects.sql` — per-user project favorites.

## [0.16.0] — 2026-07-09

- Internal improvements.

## [0.15.0] — 2026-07-02

> Areas touched: `BOARD` `AUTH` `INFRA`
> Theme: A board that never sleeps. Saves became instant and durable — they auto-retry and queue offline — dense columns render natively, and completing a card got a big friendly checkbox and a hotkey.

### Added — Never-asleep saves · `BOARD`
- Board edits now save instantly with prefetch and memoization for an instant feel, auto-retry on failure, and a durable offline queue so nothing is lost when the connection drops.

### Added — Faster completion + checklist drag · `BOARD`
- A bigger completion checkbox and a "complete card" hotkey. Checklist items can now be dragged across groups.

### Fixed — Assignee picker + mobile login · `BOARD` · `AUTH`
- Workspace members and the owner now appear in the task assignee picker. Mobile login was fixed.

### Changed — Dense columns render natively · `BOARD` · `INFRA`
- Dropped the fragile JavaScript virtualization in favor of native browser rendering for long columns.

## [0.14.0] — 2026-06-15

- Internal improvements.

## [0.13.0] — 2026-06-11

> Areas touched: `MCP` `API` `AUTH`
> Theme: Aeon connects straight into claude.ai as a remote connector over OAuth.

### Added — claude.ai remote connector (OAuth 2.1) · `MCP` · `AUTH` · `API`
- Aeon now runs an OAuth 2.1 authorization server, so Aeon's tools connect directly inside claude.ai as a remote connector — no local proxy. Includes the fix for the prerender bug that had been breaking connector discovery.

### Migrations required
- `0022_oauth.sql` — OAuth authorization-server tables.

## [0.12.0] — 2026-06-02

- Internal improvements.

## [0.11.0] — 2026-05-30

> Areas touched: `UI` `MCP` `API` `DATA` `AUTH` `BOARD`
> Theme: bring your own AI keys, Trello-style task assignment, and a Home entry at the top of every sidebar; the dashboard opens straight on your realms.

### Added — Bring Your Own AI (BYOK) · `AUTH` · `API` · `UI`
- Plug your own Anthropic, OpenAI, or Gemini key into Aeon. Encrypted at rest (AES-256-GCM), per-tier model routing (cheap / standard / heavy), one key active per provider.
- Settings cog gains an **AI** tab; `/settings/ai` opens on a redesigned landing screen (provider-tinted glass) with three provider cards: paste, reveal-toggle, test, save → rotate. The provider you point the heavy tier at gets an **Active** badge.
- Admin-gated during closed beta. Non-admin accounts see a held `Rolling out soon` state.

### Changed — The dashboard opens on your realms · `UI`
- The dashboard opens directly on your realms instead of an auto-pinned panel.

### Added — Trello-style task assignment · `BOARD` · `DATA` · `MCP`
- New `task_assignees` table. Press `M` on any selected card to open the assignee picker overlay. Multi-assign per task. Card-face avatar pile is not yet shipped — picker only.

### Added — Home entry at the top of every sidebar · `UI`
- Glowing **Home** tile sits above the realm list on every page, lighting up when you're on `/dashboard`. Replaces the ad-hoc `← Dashboard` arrows that were missing on several routes.

### Changed — `/settings/ai` now wraps in the standard sidebar shell · `UI`
- Previously rendered bare — the page now shows the same sidebar as the rest of the app, with a working Home entry.

### Changed — AI key wiring page redesigned · `UI`
- Blue, generic settings form replaced with a theme-aware, glassy, provider-tinted dashboard. Reveal toggle on the input. Test result inlines as a tinted chip. Save button label flips to **Rotate** once a key exists. Tier-routing cards flag any tier whose chosen provider has no key.

### Migrations required
- `0014_ai_integration.sql` — `user_ai_credentials`, `user_ai_preferences`.
- `0020_task_assignees.sql` — `task_assignees`.

## [0.10.0] — 2026-05-23

- Internal improvements.

## [0.9.0] — 2026-05-22

- Internal improvements.

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
