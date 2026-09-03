# ARCHITECTURE.md — Aeon

Last updated: 2026-08-26 (incremental via inferno-cartographer). Adds the **night-swarm PM wave** (PR #107, 16 commits): pinnable **floating card windows** and **column Zen mode** as focus surfaces over a still-live board; **contained bird's-eye pinch-zoom** plus the touch scroll/drag fix; **virtual team members** (accountless, realm-scoped — migration **0032**, REST + mirrored MCP, parity test) alongside optimistic instant assignment; a **favorites-first sidebar**; a rebuilt **trophy room** (gold identity, inline-SVG charts, sortable table); stable **checklist group ordering**; and one `resolvePriority` accessor replacing every duplicated priority palette. A five-reviewer pass (incl. cross-model Codex) over an already-green branch caught two data-loss paths, a rollback that deleted live rows, and — the big one — that **`api/v1/realms/**` never worked**: Next 16 hands route handlers a `params` Promise these read synchronously, so five routes written 2026-04-02 had 403'd unconditionally ever since. CI now gates on a production build. Details: [pm-app.md](architecture/pm-app.md) · [platform.md](architecture/platform.md) · [history.md](architecture/history.md).

Prior wave — **Live Mind (Kairos 0.10.0)**: continuous chat awareness (recency-weighted retrieval + LAST-24H channel + agentic tools default-ON incl. self-certification), intraday `micro-consolidate` delta folds (cron fleet **14**), the `resolves` incident lifecycle over the bi-temporal gate, and the quality-over-cost retier (all cognition heavy-tier). Earlier same day — **Kairos 0.9.0**: the synthesis-reliability heal (PRs #95–98 — repair path, health scorecard + 2-strike alerts, token-cap root cause, citation tolerance), the **Evening Digest** (guaranteed daily 18:00 UTC speak, `digest:true` register, cron fleet now **13**), speak-register hardening (opsAlert/digest excluded from the governor, `externalId` dedup), Kairos's own changelog (`docs/kairos/CHANGELOG.md`, versions 0.1→0.9), and the in-app guide refresh (McpTab 109 tools derived, galaxy help button, version pill 0.9). Prior wave (2026-07-17, PRs #71–89): whole-brain chat (Dominion picker dropped, Aether-grounded), **Telegram two-way** + **speaks-first** (`/api/v1/kairos/speak` + server throttle + the 3×/day cloud-routine **brain-tick**), **chat-distill** closing the chat→brain loop (cron fleet now **11**), bi-temporal memories (0025) + confidence decay + rerank-2.5 + Dominion auto-filing, the **Aether-UI retirement** (galaxy is the only spatial view; lieutenants 4→1 Sentinel), all **109 MCP tools annotated**, cost retier + prompt caching + the `maxOutputTokens` cap fix, project favorites (0026), and the checklist ghost-input fix. Full trail: [architecture/history.md](architecture/history.md).

> **This is a router.** The detail lives in [`architecture/`](architecture/) — one file per subsystem so you (and agents) load only what's relevant, not 1000+ lines. Read this overview first, then open the one file you need. Full change history is in [`architecture/history.md`](architecture/history.md). Strategic direction lives in [VISION.md](VISION.md); load-bearing rules live in [CLAUDE.md](CLAUDE.md).

## The architecture set

**Cross-cutting** — [`architecture/`](architecture/)

| File | Covers |
|---|---|
| [architecture/directory-map.md](architecture/directory-map.md) | Full monorepo tree — apps (web · mobile · desktop · kairos-worker), packages, every route + component dir |
| [architecture/data-layer.md](architecture/data-layer.md) | Drizzle schema (all tables), migrations (→0024), three-layer invariant, `lib/data` modules, DB-pool reliability |
| [architecture/platform.md](architecture/platform.md) | REST · mobile auth · OAuth 2.1 AS · MCP (109 tools) · AI engine · integrations · cron schedule |
| [architecture/pm-app.md](architecture/pm-app.md) | The PM surface — board/gantt/canvas/vault/velocity/realms/notes/theming + state stores + feature inventory |
| [architecture/mobile.md](architecture/mobile.md) | The Expo / React Native companion app — Google login slice + resume/handover steps |
| [architecture/inventory-and-gaps.md](architecture/inventory-and-gaps.md) | Feature-inventory pointers + known gaps & technical debt |
| [architecture/history.md](architecture/history.md) | Recent-changes trail (append-only) |

**Kairos brain** — [`architecture/kairos/`](architecture/kairos/)

| File | Covers |
|---|---|
| [architecture/kairos/overview.md](architecture/kairos/overview.md) | The brain end to end — substrate → capture → synthesis → Aether → chat; how info gets compartmentalized |
| [architecture/kairos/memory-and-capture.md](architecture/kairos/memory-and-capture.md) | `memories` substrate, all capture paths (incl. the session-capture hook), hybrid FTS+vector retrieval, dedup |
| [architecture/kairos/synthesis.md](architecture/kairos/synthesis.md) | Archetypes → cortex → Aether → Briefer, the recipe dispatcher, the nightly cron cadence |
| [architecture/kairos/chat.md](architecture/kairos/chat.md) | Chat Visor · Aether · Kairos Asks · Dialogue · the four lieutenants · the planned Aether-level mobile chat |

---

## 1. Overview

Aeon is a project-management web application built as an npm-workspaces monorepo (`apps/web` +
`apps/mobile` + `apps/desktop` + `apps/kairos-worker` + `packages/shared`). The stack is
**Next.js 16** (App Router, React Compiler, Partial Prerendering) with **TypeScript**,
**PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand**, **NextAuth v5**,
**Tailwind**, and **Framer Motion**. PM surfaces: kanban board (virtual scrolling), Gantt, canvas
whiteboard, trophy/vault archive, velocity analytics, 151 theme presets, real-time **Pusher** sync
(30s polling fallback), a PWA, and a Tauri desktop scaffold (parked). A 109-tool **MCP server** +
REST API + an OAuth 2.1 server (for the claude.ai connector) expose the data layer to AI.

**Kairos** is the AI memory-and-cognition layer — now Phase 2 of Aeon, not a side experiment. A
user-scoped substrate of `memories` is captured from many sources, consolidated nightly into
archetypes → per-Dominion cortex → a global **Aether** self-model, and served back as grounded
context through a chat Visor, proactive **Asks**, multi-turn **Dialogue**, and four lieutenant
agents. See [architecture/kairos/](architecture/kairos/).

**Mobile** is a new native **Expo / React Native** companion app (Trello model — chat first, boards
later), a thin client over the REST API; the login slice (Google auth) is scaffolded. See
[architecture/mobile.md](architecture/mobile.md).

## 2. Stack at a glance

- **Web** — Next.js 16 / React 19 / TypeScript / Drizzle / Neon Postgres / NextAuth v5 / Zustand / Tailwind / Framer Motion.
- **AI** — Vercel AI SDK over per-user BYOK keys (Anthropic / OpenAI / Google), three-tier routing; app-owned embeddings (Voyage primary / OpenAI fallback) + pgvector; MCP tool server; OAuth 2.1 AS for claude.ai.
- **Real-time** — Pusher Channels + 30s polling fallback; durable offline mutation queue for board writes.
- **Mobile** — Expo / RN 0.79 / React 19, native Google sign-in → `aeon_s1_` bearer sessions.
- **Workers** — `apps/kairos-worker` (spawn primitive); Vercel cron (9 nightly/weekly jobs).
