# ARCHITECTURE.md — Aeon

Last updated: 2026-10-01 evening (incremental Inferno Cartographer refresh; Kairos 0.11–0.15). **Eyes & Heal** (0.11, #133), **Memory engine** (0.12, #134/#135: nightly `memory-engine`, `standing` ranker, undoable `memory_ops`, thinking queue), **Beliefs & Strategy** (0.13, #136: two minds, constitution + drift probes, weekly review, 08:00 London daily message), **Ground & Protect** (0.14, #137/#138: `sourceMetadata.origin` trust labels, belief caps + `recheck` step, conscience block at answer time, nightly honesty checks), **Creativity** (0.15, #139: nightly idea tournament `idea_generate` → `idea_judge`, ≤3 inbox survivors). Claude Max routines (thinking / ideas / morning) live since 01/10. Cron fleet **17**, MCP **127** tools. Details: [overview](architecture/kairos/overview.md) · [memory-and-capture](architecture/kairos/memory-and-capture.md) · [synthesis](architecture/kairos/synthesis.md) · [chat](architecture/kairos/chat.md) · [history](architecture/history.md).

Prior wave (2026-09-21, v0.29.0, PR #130) — **AI Hangar** dedicated mission-card face, configuration/result section and realm-scoped repository manager; storage remains `boardTasks.metadata.hangar`. Durable artifact/PR delivery, publication outcome tracking and runner recovery remain incomplete. Details: [hangar.md](architecture/hangar.md) · [pm-app.md](architecture/pm-app.md).

> **This is a router.** The detail lives in [`architecture/`](architecture/) — one file per subsystem so you (and agents) load only what's relevant, not 1000+ lines. Read this overview first, then open the one file you need. Full change history is in [`architecture/history.md`](architecture/history.md). Strategic direction lives in [VISION.md](VISION.md); load-bearing rules live in [CLAUDE.md](CLAUDE.md).

## The architecture set

**Cross-cutting** — [`architecture/`](architecture/)

| File | Covers |
|---|---|
| [architecture/directory-map.md](architecture/directory-map.md) | Full monorepo tree — apps (web · mobile · desktop · kairos-worker), packages, every route + component dir |
| [architecture/data-layer.md](architecture/data-layer.md) | Drizzle schema (all tables), migrations (→0039), three-layer invariant, `lib/data` modules, DB-pool reliability |
| [architecture/platform.md](architecture/platform.md) | REST · mobile auth · OAuth 2.1 AS · MCP (127 tools) · AI engine · integrations · cron schedule (17) |
| [architecture/pm-app.md](architecture/pm-app.md) | The PM surface — board/gantt/canvas/vault/velocity/realms/notes/theming + state stores + feature inventory |
| [architecture/mobile.md](architecture/mobile.md) | The Expo / React Native companion app — Google login slice + resume/handover steps |
| [architecture/hangar.md](architecture/hangar.md) | **AI Hangar + Aeon OS** — missions on cards, the kairos-worker runner, REST/MCP session surfaces, the independent-review PASS gate, receipts, known gaps |
| [architecture/inventory-and-gaps.md](architecture/inventory-and-gaps.md) | Feature-inventory pointers + known gaps & technical debt |
| [architecture/history.md](architecture/history.md) | Recent-changes trail (append-only) |

**Kairos brain** — [`architecture/kairos/`](architecture/kairos/)

| File | Covers |
|---|---|
| [architecture/kairos/overview.md](architecture/kairos/overview.md) | The brain end to end — substrate → capture → synthesis → Aether → chat; how info gets compartmentalized |
| [architecture/kairos/memory-and-capture.md](architecture/kairos/memory-and-capture.md) | `memories` substrate, all capture paths (incl. the session-capture hook), shared standing ranker, memory engine, beliefs, constitution |
| [architecture/kairos/synthesis.md](architecture/kairos/synthesis.md) | Archetypes → cortex → Aether → Briefer → daily message, thinking queue, weekly review, drift probes, the cron cadence |
| [architecture/kairos/chat.md](architecture/kairos/chat.md) | Chat Visor (incl. `undo_kairos_change`) · Telegram + chat routine · Aether · Kairos Asks · Dialogue · Sentinel · planned mobile chat |

---

## 1. Overview

Aeon is a project-management web application built as an npm-workspaces monorepo (`apps/web` +
`apps/mobile` + `apps/desktop` + `apps/kairos-worker` + `packages/shared`). The stack is
**Next.js 16** (App Router, React Compiler, Partial Prerendering) with **TypeScript**,
**PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand**, **NextAuth v5**,
**Tailwind**, and **Framer Motion**. PM surfaces: kanban board (virtual scrolling), Gantt, canvas
whiteboard, trophy/vault archive, velocity analytics, 151 theme presets, real-time **Pusher** sync
(30s polling fallback), a PWA, and a Tauri desktop scaffold (parked). A 127-tool **MCP server** +
REST API + an OAuth 2.1 server (for the claude.ai connector) expose the data layer to AI.

**Kairos** is the AI memory-and-cognition layer — now Phase 2 of Aeon, not a side experiment. A
user-scoped substrate of `memories` is captured from many sources, consolidated nightly into
archetypes → per-Dominion cortex → a global **Aether** self-model, weighed nightly by a memory
engine (undoable), and served back as grounded
context through a chat Visor, proactive **Asks**, multi-turn **Dialogue**, a daily message, and the
Sentinel lieutenant. See [architecture/kairos/](architecture/kairos/).

**Mobile** is a new native **Expo / React Native** companion app (Trello model — chat first, boards
later), a thin client over the REST API; the login slice (Google auth) is scaffolded. See
[architecture/mobile.md](architecture/mobile.md).

## 2. Stack at a glance

- **Web** — Next.js 16 / React 19 / TypeScript / Drizzle / Neon Postgres / NextAuth v5 / Zustand / Tailwind / Framer Motion.
- **AI** — Vercel AI SDK over per-user BYOK keys (Anthropic / OpenAI / Google), three-tier routing; app-owned embeddings (Voyage primary / OpenAI fallback) + pgvector; MCP tool server; OAuth 2.1 AS for claude.ai.
- **Real-time** — Pusher Channels + 30s polling fallback; durable offline mutation queue for board writes.
- **Mobile** — Expo / RN 0.79 / React 19, native Google sign-in → `aeon_s1_` bearer sessions.
- **Workers** — `apps/kairos-worker` (spawn primitive); Vercel cron (17 jobs); Claude cloud routines (brain-tick, Kairos thinking/morning/chat).
