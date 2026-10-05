# Architecture — Directory Map

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

```
apps/
  web/                             -- Next.js 16 web app (App Router, primary surface)
    src/app/                       -- App Router pages + API routes
      page.tsx, layout.tsx         -- root entry + shell
      dashboard/                   -- workspace dashboard (WorkspaceDashboard, DashboardHeader)
      project/                     -- board/gantt/canvas project surface
      kairos/                      -- Kairos galaxy page (layout.tsx + page.tsx) — the ONLY spatial view (Aether UI + 2D retired, PR #81)
      notes/                       -- Notes bento page
      settings/ai/                 -- BYOK provider key + tier routing page
      login/ beta-terms/ invite/   -- auth + onboarding + invite acceptance
      share/ demo/                 -- public share links + demo
      api/v1/                      -- REST API (session + API-key + mobile-bearer auth)
        memories/                  -- memory REST (route, [id], capture, context, needs-summary, search, accept, [id]/trail)
        ai/ api-keys/ projects/    -- BYOK creds/prefs, key mgmt, repo->project resolve, [id]/favorite
        realms/ sessions/          -- realm CRUD, agent-session lifecycle
        recipes/traces/            -- trace history (REST mirror of get_trace_history; the run route is retired)
        projects/[id]/kairos-feed/ -- watched-board setting (PUT; mirrors set_project_kairos_feed)
        kairos/speak/              -- Kairos-initiated delivery (Will inbox + Telegram, CRON_SECRET auth)
        kairos/{memory-ops,thinking-jobs,beliefs,constitution}/ -- engine undo, thinking queue, beliefs, constitution
        kairos/{asks,voice-notes,paid-backup}/ -- open questions + dismiss, voice-note intake, paid backup switch
        auth/mobile/               -- mobile auth (google, verify, route)
        me/                        -- current-user endpoint
      api/[transport]/             -- MCP server (Bearer API key OR OAuth aeon_at_ token); 146 annotated tools; only /api/mcp;
                                      tool-host.ts (v2 shim), confirm.ts (elicitation), profiles.ts (?profile=)
      api/telegram/webhook/        -- Telegram bot webhook (secret-token auth, single-operator gate)
      api/oauth/                   -- OAuth 2.1 AS (register, authorize, token)
      api/well-known/              -- OAuth discovery fallback (real discovery is in middleware.ts)
      api/cron/                    -- 14 crons (CRON_SECRET): project-snapshot, hangar-reconcile, dominion-activity, memory-engine, thinking-sweep,
                                      chat-distill, archetype-synthesis, cortex-regen, aether-regen,
                                      embed-backfill, synthesis-health, ask-mine, constitution-seed,
                                      daily-message (most are fallbacks for the Max-plan routine)
      api/auth/ api/export/        -- NextAuth handlers; snapshot export
      api/planets/                 -- GET list of the 55 planet image names (public, static)
      api/v1/dominions/focus/ [id]/ -- 0.45: ranked focus read; PATCH dominion (pinned). /api/v1/vorath/* rewrites to /api/v1/kairos/*
      vorath/                      -- the Vorath page (0.44); kairos/ = permanent redirect
  lib/kairos/living/               -- Living Dominions: score, signals, attribution, repo-slug, focus seam, plan-* consumers, flag
  lib/kairos/sensitive/            -- private-topic hold: lexicon, capture stamp, meta, pref
  lib/kairos/triage/               -- card sorting: prompt, similarity, resolve, types
  lib/env/                         -- mind-env-alias.ts (VORATH_* -> KAIROS_*)
  components/kairos/knows/         -- What Vorath knows drawer: KnowsList, NeedsEyesList, WhyPanel, FixPanel, SensitiveToggle
  components/board/triage/         -- Vorath suggests block + per-board toggle
      api/stats/                   -- GET the signed-in user's totals (projects, tasks, checklist items, nodes, events, member since) for the Stats modal
      api/sync/version/[projectId] -- GET a project's boardVersion + updatedAt — polled by useProjectData, the 30s fallback when Pusher is down
    src/components/
      board/                       -- kanban, task edit, DnD, filters, virtual scroll, assignee overlay + pile,
                                      FavoriteStar, checklist/ (ghost-input new-item flow, reorder.ts), triState.ts,
                                      fusion (FuseCardsModal, FusionEffect), hold-to-move, MissionEditorModal, TaskMembersSection
      canvas/                      -- whiteboard (ReactFlow)
      gantt/                       -- Gantt chart
      hyperspace/                  -- Capture FAB + QuickCapture + EOD reflection
      kairos/                      -- galaxy (Kairos3D only — 2D removed), KairosInbox (Will bell/panel + idea cards,
                                      today's message pinned), Visor + chat stream (KairosVisorReplyWatch polls routine replies),
                                      thread list, Dominion create/edit, MemorySidePanel; scene/; flightdeck/ (FlightDeckDrawer, TowerOverlay)
      kairos/brain/                -- "Set up Kairos" modal (ConnectKairosModal): tabs Setup (SetupChecklist — required
                                      steps with live ticks, optional extras), Health (StatusView + paid backup switch),
                                      Brain map, Watched (boards + repos; voice notes), How it works
      notes/ sidebar/ trophy/      -- notes bento, AppSidebar, trophy/vault archive
      velocity/ ui/                -- analytics charts; settings/help/command-palette/toast
      layout/ project/ workspace/  -- layout chrome, project chrome, workspace dashboard parts
      providers/ pwa/              -- context providers, PWA install/offline
      effects/ skybox/ celebrations/ -- visual FX, skybox, celebration animations
    src/lib/
      data/                        -- pure data-layer queries (see data-layer.md for full list)
      actions/                     -- auth-guarded server actions (mutations)
      ai/                          -- crypto, provider, providers (catalog derived from the shared model registry),
                                      providers-ui, router (paid backup choke point), route-task
      kairos/                      -- auto-capture, project-snapshot, spawn, cortex, archetypes, aether,
                                      ask, ask-mine, ask-numbered, dialogue, retrieve,
                                      chat-prompt/retrieval/turn, chat-routine, chat-web-routine, embeddings, streamClass,
                                      dedup, lifecycle, dominionTags, recipes/ (retrieval types only),
                                      confidence, rerank, rrf, autofile, chat-distill(-prompt), telegram,
                                      cron-trace, origin, conscience-context, daily-message(-inputs/-prompt),
                                      voice-note(-confirm), paid-backup(-cron), synthesis-health,
                                      engine/ (night steps incl. recheck), thinking/ (queue + 24 handlers),
                                      routines/ (catalog.ts — the two Max routines, prompts, BRAIN_JOBS; setup.ts),
                                      beliefs/, concepts/, constitution/ (incl. conscience-probes), weekly-review/, ideas/
      realtime/                    -- lib/realtime: publishBoardEvent() sends a "board-update" Pusher event on a project's channel
                                      (no-op when Pusher isn't configured; clients fall back to 30s polling via api/sync)
      oauth/                       -- pkce (S256), origin helper
      db/                          -- schema.ts + index.ts (Neon Pool)
      store/                       -- Zustand: boardStore, canvasStore, ganttStore, undoStore, hangarUiStore,
                                      pinnedCardsStore, zenModeStore, mutationDispatch, mutationQueue, persistMutation
      schedule/ flightdeck/ hangar-models.ts -- Chronos solver (unwired), Flight Deck timeline, engine model catalogue
      api/ auth.ts pusher.ts email.ts changelog.ts version.ts
    src/stores/                    -- Zustand: themeStore, sidebarStore, kairosStore,
                                      kairosVisorStore, kairosPrefsStore
    src/assets/ config/ types/ middleware.ts
    drizzle/                       -- migrations 0000 -> 0039 (hand-written past 0010; no 0038 on main; see data-layer.md)
    scripts/                     -- apply-*-migration.mjs, verify-schema-drift.mjs, session-capture-* pipeline, smoke-auth.mjs
  mobile/                          -- Expo / React Native companion app (NEW 2026-06-27)
    App.tsx index.ts app.json      -- Expo SDK 53, RN 0.79, React 19; v1 = Kairos chat
    babel.config.js metro.config.js tsconfig.json
    src/                           -- api.ts (apiFetch + bearer), auth.ts (Google sign-in), config.ts
    (see mobile.md)
  desktop/                         -- Tauri desktop shell (scaffold, parked): package.json + src-tauri/
  kairos-worker/                   -- Hangar runner (Node): src/{index,poller,engines,models,worktree,envelope,stream-parser}.ts
                                      (models.ts reads the shared model registry);
                                      runner.env.bat (ignored creds), start-hangar-runner.bat — see hangar.md
aeon_os/                           -- Aeon OS: production-verification harness + docs (summary, test_readiness, HANDOVER_*)
  workflows/                       -- run.mjs, review.mjs, review-bundle.mjs, prod-acceptance.mjs, verify-ui.mjs,
                                      review-gate.test.mjs, bootstrap.json; results/ = committed receipts; .runtime/ = ignored
packages/
  shared/src/
    ai/                            -- model-registry.json (every model, defaults + effort, legacyRemap, reviewedAt) +
                                      models.ts (typed access, imported as @aeon/shared/ai/models) — see platform.md §5
    config/themes/                 -- 17 theme category files + index (151 presets)
    config/defaults.ts             -- default preferences + shortcuts
    types/                         -- board, canvas, gantt, celebrations, index
    utils/                         -- boardFilters (shared with web)
    index.ts                       -- package barrel
scripts/
  aeon-freshness.mjs               -- "living world" freshness report (npm run freshness) — see docs/aeon-living-world.md
  freshness/                       -- lib.mjs (pure rules) + retired-terms.json; tests in scripts/__tests__/
```

**Root files:** `CLAUDE.md`, `ARCHITECTURE.md` (router), `VISION.md`, `README.md`, `CHANGELOG.md` (mirrored into `apps/web/src/lib/changelog.ts`), `SETUP.md`, `start.bat`. Detailed design notes + handovers live in `docs/` (esp. `docs/kairos/` — numbered design/handover docs through `35-creativity.md`; `25-working-with-the-kairos-brain.md` is the owner setup guide and `33-thinking-routine.md` the routine reference; `docs/aeon-living-world.md` explains the freshness check). `apps/web/vercel.json` carries the cron schedule.
