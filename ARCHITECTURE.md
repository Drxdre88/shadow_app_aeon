# ARCHITECTURE.md — Aeon

Last updated: 2026-06-27 (**architecture split into an `architecture/` folder**; content refreshed to current code). Reorg: the old 467-line monolith became a router (this file) + one file per subsystem under [`architecture/`](architecture/), mirroring the Swarm convention. Refresh captures everything since the 2026-06-06 doc: **MCP 109 tools / 19 categories** (added synthesis · ask · dialogue), **migrations through 0024** (pgvector embeddings + memory provenance), the **Aether** global self-model + **Kairos Asks** + **Dialogue** + **guided introspection**, the app-owned **embedding layer** (Voyage/OpenAI) + **9-cron** nightly pipeline, board **avatar pile** + **never-asleep durable save queue** + **Smooth-UI-Renders** toggle, the **keep-warm cron removal**, and the new **Expo mobile app** (Google login slice).

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
