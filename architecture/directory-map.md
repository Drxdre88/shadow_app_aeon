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
        recipes/                   -- recipe REST (route, run, traces)
        kairos/speak/              -- Kairos-initiated delivery (Will inbox + Telegram, CRON_SECRET auth)
        auth/mobile/               -- mobile auth (google, verify, route)
        me/                        -- current-user endpoint
      api/[transport]/             -- MCP server (Bearer API key OR OAuth aeon_at_ token); 109 annotated tools
      api/telegram/webhook/        -- Telegram bot webhook (secret-token auth, single-operator gate)
      api/oauth/                   -- OAuth 2.1 AS (register, authorize, token)
      api/well-known/              -- OAuth discovery fallback (real discovery is in middleware.ts)
      api/cron/                    -- 11 crons (CRON_SECRET): briefer, project-snapshot,
                                      archetype-synthesis, cortex-regen, aether-regen, embed-backfill,
                                      introspection, memory-dedup, memory-compaction,
                                      chat-distill, contradiction-scan
      api/auth/ export/ planets/ stats/ sync/  -- NextAuth, export, misc surfaces
    src/components/
      board/                       -- kanban, task edit, DnD, filters, virtual scroll, assignee overlay + pile,
                                      FavoriteStar, checklist/ (ghost-input new-item flow, reorder.ts), triState.ts
      canvas/                      -- whiteboard (ReactFlow)
      gantt/                       -- Gantt chart
      hyperspace/                  -- Daily Briefing card + EOD + Capture FAB + QuickCapture
      kairos/                      -- galaxy (Kairos3D only — 2D removed), KairosInbox (Will bell/panel),
                                      AdvisoryFeed, Visor + chat stream, thread list,
                                      Dominion create/edit, MemorySidePanel; scene/
      notes/ sidebar/ trophy/      -- notes bento, AppSidebar, trophy/vault archive
      velocity/ ui/                -- analytics charts; settings/help/command-palette/toast
      layout/ project/ workspace/  -- layout chrome, project chrome, workspace dashboard parts
      providers/ pwa/              -- context providers, PWA install/offline
      effects/ skybox/ celebrations/ -- visual FX, skybox, celebration animations
    src/lib/
      data/                        -- pure data-layer queries (see data-layer.md for full list)
      actions/                     -- auth-guarded server actions (mutations)
      ai/                          -- crypto, provider, providers, providers-ui, router, route-task
      kairos/                      -- briefer, auto-capture, project-snapshot, spawn, dispatch,
                                      cortex, archetypes, aether, ask, dialogue, retrieve,
                                      chat-prompt/retrieval/turn, embeddings, introspection, streamClass,
                                      dedup, lifecycle, dominionTags, recipes/,
                                      confidence, rerank, rrf, autofile, contradiction(-prompt),
                                      chat-distill(-prompt), telegram, cron-trace
      oauth/                       -- pkce (S256), origin helper
      db/                          -- schema.ts + index.ts (Neon Pool)
      store/                       -- Zustand: boardStore, canvasStore, ganttStore, undoStore,
                                      mutationDispatch, mutationQueue, persistMutation
      api/ auth.ts realtime/ pusher.ts email.ts changelog.ts version.ts
    src/stores/                    -- Zustand: themeStore, sidebarStore, kairosStore,
                                      kairosVisorStore, kairosPrefsStore
    src/assets/ config/ types/ middleware.ts
    drizzle/                       -- migrations 0000 -> 0026
  mobile/                          -- Expo / React Native companion app (NEW 2026-06-27)
    App.tsx index.ts app.json      -- Expo SDK 53, RN 0.79, React 19; v1 = Kairos chat
    babel.config.js metro.config.js tsconfig.json
    src/                           -- api.ts (apiFetch + bearer), auth.ts (Google sign-in), config.ts
    (see mobile.md)
  desktop/                         -- Tauri desktop shell (scaffold, parked): package.json + src-tauri/
  kairos-worker/                   -- standalone Node HTTP server: index.ts, spawner.ts, callback.ts
packages/
  shared/src/
    config/themes/                 -- 17 theme category files + index (151 presets)
    config/defaults.ts             -- default preferences + shortcuts
    types/                         -- board, canvas, gantt, celebrations, index
    utils/                         -- boardFilters (shared with web)
    index.ts                       -- package barrel
```

**Root files:** `CLAUDE.md`, `ARCHITECTURE.md` (router), `VISION.md`, `README.md`, `CHANGELOG.md`, `SETUP.md`. Detailed design notes + handovers live in `docs/` (esp. `docs/kairos/` — 29 numbered design/handover docs; `29-brain-tick.md` is executed by the scheduled cloud routine). `vercel.json` carries the cron schedule.
