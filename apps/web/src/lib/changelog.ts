// In-app copy of /CHANGELOG.md. Kept in sync manually on every version bump.
// The file is small enough that this is cheaper than wiring a build-time
// raw-import. When you update /CHANGELOG.md, paste the whole document below.
//
// Area pills (BOARD / GANTT / CANVAS / KAIROS / DOMINION / REALM / AUTH /
// MCP / API / DATA / INFRA / DOCS / UI) tag each section's domain. They
// render as fixed-colour categorical chips inside the modal — orthogonal to
// the Added/Changed/Fixed axis.

export const CHANGELOG_MD = `# Changelog

All notable changes to **Aeon** are documented here. Closed beta — versions track milestone drops rather than strict semver.

## Legend — Area pills

Each section tags its **domain** (orthogonal to Added/Changed/Fixed):

- \`BOARD\` — kanban surface (columns, cards, DnD, filters, virtual scroll)
- \`GANTT\` — timeline view, swim-lane rows, saved views
- \`CANVAS\` — freeform whiteboard (ReactFlow)
- \`KAIROS\` — memory graph (2D + 3D WebGL, side panel, sidebar pill)
- \`DOMINION\` — top-level grouping above project (memories + projects + repos)
- \`REALM\` — workspace groups, invites, member roles, scoped visibility
- \`AUTH\` — NextAuth, OAuth providers, sessions, mobile auth
- \`MCP\` — MCP tool server (94 tools across 14 categories)
- \`API\` — REST routes under \`/api/v1/\`
- \`DATA\` — schema, migrations, Drizzle queries
- \`INFRA\` — Capacitor, PWA, Pusher, build, deploy
- \`DOCS\` — \`ARCHITECTURE.md\`, \`VISION.md\`, \`CLAUDE.md\`
- \`UI\` — sidebar, settings, modals, themes (151 presets), effects

## [0.11.0] — 2026-05-30

> Areas touched: \`KAIROS\` \`DOMINION\` \`UI\` \`MCP\` \`API\` \`DATA\` \`AUTH\` \`BOARD\` \`DOCS\`
> Theme: Kairos becomes a daily companion — auto-capture, daily briefer, advisory feed, agent spawn — gated by your own AI keys. Sidebar gets a Home entry, the dashboard stops shouting at you, and the AI key page is rebuilt in product voice.

### Added — Bring Your Own AI (BYOK) · \`KAIROS\` · \`AUTH\` · \`API\` · \`UI\`
- Plug your own Anthropic, OpenAI, or Gemini key into Aeon. Encrypted at rest (AES-256-GCM), per-tier model routing (cheap / standard / heavy), one key active per provider.
- Settings cog gains an **AI** tab; \`/settings/ai\` opens on a redesigned landing screen (provider-tinted glass) with three provider cards: paste, reveal-toggle, test, save → rotate. The provider you point the heavy tier at gets an **Active** badge.
- Admin-gated during closed beta. Non-admin accounts see a held \`Rolling out soon\` state.

### Added — Daily Briefer · \`KAIROS\`
- A 7 a.m. cron writes one advisory per active Dominion using your BYOK heavy-tier model. The advisory is anchored to that Dominion and idempotent — running twice on the same day is a no-op.
- The Daily Briefing card has three explicit states: no key wired → CTA, key wired but no advisory today → manual **Run now**, advisory present → render with provider pills in the header.

### Added — Daily Briefing + EOD Reflection as sidebar popovers · \`UI\` · \`KAIROS\`
- Both have moved out of the auto-pinned dashboard slot. The dashboard now opens directly on your realms.
- Sun icon = Daily Briefing popover. Moon icon = End-of-Day reflection (three fields: what happened, what did I decide, what's still open; idempotent per day, day-resets after midnight).
- Both share a new \`AnchoredPopover\` primitive that flips below the trigger when there isn't room above and closes on Escape.

### Added — Advisory feed (ambient sidebar) · \`KAIROS\`
- Sparkle icon in the sidebar shows an unread count. Popover lists the last 3 days of advisories with acknowledge (soft-archive) and \`open →\` deep-link to the memory in Kairos.

### Added — Auto-capture (board + project events) · \`KAIROS\` · \`DATA\`
- Task and project mutations now fire-and-forget into the memory layer (created, updated, moved, completed, deleted). The Notes bento and Kairos graph populate themselves as you work.
- A nightly project-snapshot cron writes one memory per project per day: open / done / blocked counts plus the last 5 events.

### Added — Kairos Spawn primitive · \`KAIROS\` · \`API\` · \`DATA\` · \`MCP\`
- New \`agent_sessions\` + \`session_events\` tables and \`apps/kairos-worker/\` — a standalone Node HTTP service that shells the Claude Code / Codex CLI on your behalf.
- Live Sessions button in the sidebar shows running sessions with a pulsing badge, a transcript that polls every 2 s, and a kill switch. Full REST (\`/api/v1/sessions/*\`) and MCP (\`spawn_session\`, \`list_sessions\`, \`get_session\`, \`list_session_events\`, \`kill_session\`) parity.

### Added — Notes bento page (\`/notes\`) · \`KAIROS\` · \`UI\`
- Pinterest-style grid of memories with today's auto-capture strip up top, a neighbours panel that re-seeds on any linked memory, and **Promote to Card** (convert a memory into a board task).

### Added — Trello-style task assignment · \`BOARD\` · \`DATA\` · \`MCP\`
- New \`task_assignees\` table. Press \`M\` on any selected card to open the assignee picker overlay. Multi-assign per task. Card-face avatar pile is not yet shipped — picker only.

### Added — Home entry at the top of every sidebar · \`UI\`
- Glowing **Home** tile sits above the realm list on every page, lighting up when you're on \`/dashboard\`. Replaces the ad-hoc \`← Dashboard\` arrows that were missing on several routes.
- Bottom pill row reorganised: top cluster = today (Notes / Briefing / Advisories / EOD / Live sessions); bottom cluster = utilities (Changelog / Beta features / Help / Stats / Settings).

### Added — Dominion editor + creator · \`DOMINION\` · \`UI\`
- **New Dominion** sidebar action opens a glassy creation modal (name, color, icon).
- Dominion edit drawer lets you inline-edit vision, long-form mission, objectives (status + target date), and the visual treatment.

### Changed — \`/notes\` and \`/settings/ai\` now wrap in the standard sidebar shell · \`UI\`
- Previously rendered bare — both pages now show the same sidebar as the rest of the app, with a working Home entry.

### Changed — AI key wiring page redesigned · \`UI\` · \`KAIROS\`
- Blue, generic settings form replaced with a theme-aware, glassy, provider-tinted dashboard. Reveal toggle on the input. Test result inlines as a tinted chip. Save button label flips to **Rotate** once a key exists. Tier-routing cards flag any tier whose chosen provider has no key.

### Changed — MCP tool count: 76 → 94 · \`MCP\`
- +16 in **dominions** (CRUD, vision, objectives, repo mapping, project assignment, bulk assign), +5 in **sessions** (spawn, list, get, events, kill). Realms grew +3 (members + invites). Total now 14 categories.

### Fixed — Help / Stats / Settings modals no longer get overlapped by Kairos node labels · \`UI\`
- Bumped from \`z-50\` to \`z-[200]\` so the 3D graph's planet labels (drei \`Html zIndexRange={[100,0]}\`) sit below them. Same fix as previously applied to the changelog + features modals.

### Fixed — EOD reflection's "already today" flag persisted across midnight · \`KAIROS\`
- A tab left open overnight kept showing yesterday's status. The flag now invalidates when the captured day no longer matches today's tag.

### Fixed — Daily Briefing card no longer crashes on a corrupt cache entry · \`KAIROS\`
- Each cached advisory is shape-checked on parse; mismatches trigger a clean refetch instead of throwing inside the markdown renderer.

### Fixed — Briefing provider pill no longer flickers · \`KAIROS\` · \`DATA\`
- When the heavy-tier preference isn't wired, the fallback active provider is now picked from a deterministically ordered credential list (was undefined Postgres row order).

### Migrations required
- \`0014_ai_integration.sql\` — \`user_ai_credentials\`, \`user_ai_preferences\`.
- \`0017_dominion_body.sql\` — vision / mission / objectives on \`dominions\`; \`dominion_objectives\` table.
- \`0018_engine_policies.sql\` — \`engine_policies\` for routing overrides.
- \`0019_agent_sessions.sql\` — \`agent_sessions\` + \`session_events\`.
- \`0020_task_assignees.sql\` — \`task_assignees\`.

## [0.10.0] — 2026-05-23

> Areas touched: \`KAIROS\` \`DOMINION\` \`MCP\` \`API\` \`DATA\` \`UI\` \`DOCS\`
> Theme: Kairos K-0 through K-5 complete. 2D WebGL graph with cross-repo connections via Dominions, memory backfill tool, in-app onboarding modal.

### Added — Kairos 2D WebGL graph · \`KAIROS\` · \`UI\`
- Orthographic Three.js scene via \`@react-three/fiber\` + \`d3-force-3d\`. Orthographic camera controls, planet-cloud node rendering, real edge lines, starfield backdrop.
- Color modes: by **Dominion**, by type, by realm, by recency.
- \`MemorySidePanel\` renders the AI-cleaned title + execSummary bullets when a node is selected.
- Cross-repo edges now appear automatically when memories share a Dominion.

### Added — Dominions (top-level grouping above project) · \`DOMINION\` · \`DATA\` · \`MCP\`
- New tables \`dominions\` + \`dominion_repos\`. \`projects.dominion_id\` and \`memories.dominion_id\` foreign keys added.
- Dominion resolves for a memory in this order: explicit \`memory.dominion_id\` ?? owning \`project.dominion_id\` ?? \`dominion_repos\` lookup via \`sourceMetadata.repo\` ?? Unassigned.
- 10 new MCP tools: CRUD + \`add_dominion_repo\` / \`remove_dominion_repo\` / \`assign_project_dominion\` / \`bulk_assign_projects_to_dominion\`.
- REST surface for Dominions is **not yet built** — flagged as known gap.

### Added — \`list_memories_needing_summary\` MCP tool + REST mirror · \`MCP\` · \`API\`
- Returns memories with empty \`execSummary\` (and/or null \`aiTitle\`) so the caller can backfill them via \`update_memory\` in a loop.
- REST mirror at \`GET /api/v1/memories/needs-summary\`.
- Memory parity test now locks 7 MCP tools against 9 REST routes.

### Added — Kairos Setup + Guide modal · \`KAIROS\` · \`UI\`
- Glowing pill in the sidebar (between realm list and create actions) opens a two-tab onboarding modal.
- Setup walks new users through MCP configuration; Guide is the usage reference.

### Fixed — 2D edges now render after the first d3-force tick · \`KAIROS\`
- d3-force mutates \`link.source\` / \`link.target\` from string IDs to node refs after the first tick. The renderer was doing \`nodeById.get(string)\` every frame and the lookup quietly returned undefined. One-line guard added.

### Changed — \`ARCHITECTURE.md\` and \`VISION.md\` refreshed · \`DOCS\`
- MCP tool count bumped 63 → 76. K-0 through K-5 marked complete. K-6 (Dominion REST + bulk-assign UX) and K-7 (BYOK merge) added.

### Migrations required
- \`0015_kairos_summaries.sql\` — adds \`ai_title varchar(120)\` and \`exec_summary jsonb default []\` to \`memories\`.
- \`0016_dominion.sql\` — creates \`dominions\` + \`dominion_repos\`, adds \`dominion_id\` to \`projects\` and \`memories\`.

## [0.9.0] — 2026-05-22

> Areas touched: \`KAIROS\` \`DATA\` \`UI\` \`MCP\`
> Theme: Brain → Kairos rebrand, memory display rework, AI-cleaned title + exec summary schema.

### Changed — Brain → Kairos rebrand · \`KAIROS\` · \`UI\` · \`DOCS\`
- All paths and references: \`app/brain/\` → \`app/kairos/\`, \`components/brain/\` → \`components/kairos/\`, \`docs/brain/\` → \`docs/kairos/\`. Route is now \`/kairos\`.
- Sidebar header animates \`AEON : KAIROS\` with a pulsing glow when on the Kairos route.

### Added — Memory schema for AI-cleaned display · \`DATA\` · \`MCP\`
- \`memories.aiTitle\` (varchar 120, nullable) — 1–6 word AI-cleaned title for front-of-house display.
- \`memories.execSummary\` (jsonb default \`[]\`) — 5–10 bullet array.
- \`create_memory\` and \`update_memory\` MCP tools accept and return both fields.
- The Aeon server does **no LLM work** — all summarisation happens at the call site (Claude Code self-cleans, then sends pre-cleaned payload).

### Added — \`MemorySidePanel\` rework · \`KAIROS\` · \`UI\`
- Title + colour pills + execSummary bullets + collapsed body. Graceful empty-state for memories that pre-date the schema.

## [0.8.0] — 2026-04-07

> Areas touched: \`BOARD\` \`GANTT\` \`INFRA\`
> Theme: Phase 3 — real-time sync, virtual scrolling, optimistic UI rollback.

### Added — Pusher real-time sync · \`BOARD\` · \`GANTT\` · \`INFRA\`
- Pusher Channels broadcast every board / column / task / label / dep / checklist / comment mutation.
- ~1s push, 30s polling fallback. Sub-second multi-user sync.
- \`boardVersion\` bumped on every mutation via \`touchProject()\`.

### Added — Virtual scrolling on large boards · \`BOARD\` · \`UI\`
- TanStack Virtual kicks in at 15+ cards per column.
- \`ESTIMATED_CARD_HEIGHT\` tuned for the dense-card layout.

### Added — Optimistic UI rollback on every mutation · \`BOARD\`
- Every board mutation snapshots state, mutates locally, and rolls back if the server rejects.

### Removed — React Native mobile scaffold · \`INFRA\`
- The \`apps/mobile/\` Expo scaffold (~680 lines) was deleted after the 03/04 Capacitor pivot. Mobile is now WebView-wrapped over the existing Next.js app.

## [0.7.0] — 2026-04-04

> Areas touched: \`UI\` \`AUTH\` \`INFRA\` \`DATA\`
> Theme: Phase 2.5 — perf, hardening, glow source, React Compiler, PPR, security fixes.

### Added — React Compiler + PPR · \`INFRA\`
- React Compiler enabled for automatic memoisation.
- Partial Prerendering on dashboard + board surfaces.

### Changed — Zustand selector audit (22 files) · \`UI\`
- Audit replaced object selectors with scoped primitive selectors to kill re-renders.

### Added — Glow Source setting · \`UI\`
- Per-priority glow colour selection. Replaces the older single-glow setting.

### Changed — Checklist UX polish · \`BOARD\`
- Tri-state checkboxes (todo / doing / done), grouped, sortable. Ref-based commit guards prevent blur-loop overwrites.

### Fixed — Horsemen security pass · \`AUTH\` · \`API\`
- Multiple input-validation + scope-elevation paths tightened across realm and project surfaces.

## [0.6.0] — 2026-04-03

> Areas touched: \`INFRA\` \`AUTH\`
> Theme: Mobile strategy pivot — React Native → Capacitor. PWA enabled.

### Changed — Mobile strategy: Capacitor over React Native · \`INFRA\`
- React Native would have required a 3–6 month UI rewrite to reach 50–70% visual fidelity. Capacitor wraps the existing Next.js app as-is.
- Mobile auth backend (\`mobile-auth.ts\`, session tokens, OAuth) remains valid for Capacitor's bearer-auth needs.

### Added — PWA shell · \`INFRA\` · \`UI\`
- \`manifest.json\`, service worker with precaching, offline fallback page.
- Desktop install via PWA covers ~80% of desktop use cases for free. Tauri scaffold parked.

## [0.5.0] — 2026-04-02

> Areas touched: \`REALM\` \`AUTH\` \`API\` \`UI\`
> Theme: Phase 1.5 hardening — realm invites, REST API parity, lint cleanup, file splits, server-side loading.

### Added — Realm invites · \`REALM\` · \`AUTH\`
- Token-based invite, 7-day expiry, email notification via Resend.
- Realm invite acceptance page at \`/invite/realm/[token]\`.

### Added — Realm REST API · \`REALM\` · \`API\`
- 6 route files under \`/api/v1/realms/\` — full CRUD + members + projects.

### Changed — Server-side loading · \`UI\`
- Board and dashboard now SSR. \`auth()\` calls cached per-request. No more loading spinners on initial render.

### Changed — Lint + file-split cleanup · \`UI\`
- 46 lint warnings → 9. Multiple god-components split into directories with stable public import paths.

## [0.4.0] — 2026-04-01

> Areas touched: \`REALM\` \`AUTH\` \`UI\`
> Theme: Scoped visibility, ProjectSidebar, access denied page.

### Added — Scoped visibility · \`REALM\` · \`AUTH\`
- Per-project-per-realm visibility scoping. Realm members see only what was shared with that realm.

### Added — \`ProjectSidebar\` · \`UI\`
- Dedicated board-view sidebar. Frees \`AppSidebar\` for dashboard nav.

### Added — Access denied page · \`AUTH\`
- Graceful page for users who land on a project they aren't a member of.

## [0.3.0] — 2026-03-31

> Areas touched: \`REALM\` · \`UI\`
> Theme: Flat realm list, killed Personal/Team split.

### Changed — Flat realm list with TEAM badge · \`REALM\` · \`UI\`
- Personal and Team workspaces collapsed into one list. TEAM badge replaces the section split.
- Viewport-locked layout — no horizontal scroll on small screens.

### Added — Custom realm icons + 7 colours · \`REALM\`
- 16 Lucide icon options. 7 base colours that flow through the realm's glow palette.

## [0.2.0] — 2026-03-30

> Areas touched: \`MCP\` · \`REALM\` · \`UI\`
> Theme: Sidebar nav rework, MCP realm tools.

### Added — \`AppSidebar\` with realm sections · \`UI\`
- Collapsible sidebar with realm list and member preview.

### Added — MCP realm tools (11) · \`MCP\` · \`REALM\`
- CRUD + members (list / invite / remove / update role) + projects (list / add / remove).

## [0.1.0] — 2026-03-24

Initial closed beta · \`BOARD\` \`GANTT\` \`CANVAS\` \`DATA\` \`API\`

- Kanban board with full DnD, custom columns, labels, dependencies, checklists.
- Gantt timeline with swim-lane rows and saved views.
- Canvas (ReactFlow whiteboard) with node + edge editing.
- Trophy / Vault archive for completed tasks.
- 151 theme presets across 17 categories.
- MCP server (52 tools at this point) with Bearer auth.
- REST API under \`/api/v1/\` with session + API key auth.
- NextAuth v5 with Google, GitHub, and Resend magic-link providers.
`
