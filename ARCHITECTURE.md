# ARCHITECTURE.md — Aeon

Last updated: 2026-10-06 (Inferno Cartographer refresh; **Vorath** 0.26–0.28 / app v0.44–v0.46 — see the current-state paragraph below, [kairos/mind.md](architecture/kairos/mind.md) §4b and [hangar.md](architecture/hangar.md) §2b). Previous refresh 2026-10-04 (Kairos 0.20–0.25 — see the current-state paragraph below and [kairos/mind.md](architecture/kairos/mind.md)). Earlier era (2026-10-01, Kairos 0.11–0.16): **Eyes & Heal** (0.11, #133), **Memory engine** (0.12, #134/#135: nightly `memory-engine`, `standing` ranker, undoable `memory_ops`, thinking queue), **Beliefs & Strategy** (0.13, #136: two minds, constitution + drift probes, weekly review, 08:00 London daily message), **Ground & Protect** (0.14, #137/#138: `sourceMetadata.origin` trust labels, belief caps + `recheck` step, conscience block at answer time, nightly honesty checks), **Creativity** (0.15, #139: nightly idea tournament `idea_generate` → `idea_judge`, ≤3 inbox survivors). **All on Max** (0.16, #141: every former paid-key cron is a thinking job; six Opus routines; crons are fallbacks). Cron fleet **17**, MCP **127** tools. Details: [overview](architecture/kairos/overview.md) · [memory-and-capture](architecture/kairos/memory-and-capture.md) · [synthesis](architecture/kairos/synthesis.md) · [chat](architecture/kairos/chat.md) · [history](architecture/history.md).

**Current state (2026-10-06, Vorath 0.28 / app v0.46.0 — supersedes the counts below):** Kairos is renamed **Vorath** (0.26: display name, persona, `/vorath`, `VORATH_*` env alias, `/api/v1/vorath` rewrite; stored keys, tool names and code paths keep `kairos`). **Living Dominions** phase 1 (0.27: nightly activity score, dormant/pinned areas, one ranked roster, `dominion_members` table — migration **0040**; switch `KAIROS_LIVING_DOMINIONS`, off). **Wave A** (0.28 / v0.46): *What Vorath knows* (provenance, fix in place, needs-your-eyes, opt-in private-topic hold), **Hangar autopilot** (stall reconciler cron, requeue, plan-first, answer & relaunch, follow-ups → cards), **Connector 2.0** (mcp-handler 2.2 + MCP SDK v2, protocol 2026-07-28 with legacy fallback, confirmations on destructive tools, `?profile=` tool sets) and **card sorting** (`card_triage`, per-board toggle, off). 30 thinking kinds (incl. chat; the Workforce kinds since 0.29 are in [kairos/mind.md](architecture/kairos/mind.md)); cron fleet **14**; MCP **146** tools.

Previous state (2026-10-04, Kairos 0.25 / app v0.43.0): **One mind everywhere** (0.21: shared today log across Telegram/web/Triad/Claude, on by default; daytime `reflect` + Sonnet `pulse`, track record, Horae) and **one coherent mind**, waves 1–4 (0.22 stage, character check, cold read; 0.23 surprise engine + firewalled dreams; 0.24 idea atlas, Swiss rounds, collisions, anti-sameness, incubation, stepping stones, taste; 0.25 the `lib/kairos/moment/` seam — Kairos gate, owner traits vs states + weekly card, readiness/bids/repair, earned trust + ask-first, monthly life chapters). All flag-gated and off by default; no schema change; three Max routines (brain hourly, chat, pulse); 24 thinking kinds; cron fleet **12**; MCP **145** tools; 13 new Kairos read tools with REST mirrors. Detail: [kairos/mind.md](architecture/kairos/mind.md).

Previous state (2026-10-02, Kairos 0.19 / app v0.37.0): **Simplified brain** (0.17: two Max routines defined in code, `lib/kairos/routines/catalog.ts`; the six 0.16 routines and the brain-tick retired), **catch-up mornings, watched boards, voice notes** (0.18: 06:00 London daily message with numbered open questions), **no paid spend + one setup checklist** (0.19: paid backup switch, web chat on Max, *Set up Kairos* modal). Cron fleet **12**, MCP **132** tools / 27 categories. v0.37.0 adds the **shared model registry** (`packages/shared/src/ai/model-registry.json` — Opus 5.5 defaults with effort, legacy ids remapped at read time; [platform.md](architecture/platform.md) §5) and the **living-world freshness check** (`npm run freshness`; [docs/aeon-living-world.md](docs/aeon-living-world.md)). Setup checklist: [overview](architecture/kairos/overview.md) "Set up Kairos" + `docs/kairos/33-thinking-routine.md`.

Prior wave (2026-09-21, v0.29.0, PR #130) — **AI Hangar** dedicated mission-card face, configuration/result section and realm-scoped repository manager; storage remains `boardTasks.metadata.hangar`. Durable artifact/PR delivery, publication outcome tracking and runner recovery remain incomplete. Details: [hangar.md](architecture/hangar.md) · [pm-app.md](architecture/pm-app.md).

> **This is a router.** The detail lives in [`architecture/`](architecture/) — one file per subsystem so you (and agents) load only what's relevant, not 1000+ lines. Read this overview first, then open the one file you need. Full change history is in [`architecture/history.md`](architecture/history.md). Strategic direction lives in [VISION.md](VISION.md); load-bearing rules live in [CLAUDE.md](CLAUDE.md).

## The architecture set

**Cross-cutting** — [`architecture/`](architecture/)

| File | Covers |
|---|---|
| [architecture/directory-map.md](architecture/directory-map.md) | Full monorepo tree — apps (web · mobile · desktop · kairos-worker), packages, every route + component dir |
| [architecture/data-layer.md](architecture/data-layer.md) | Drizzle schema (all tables), migrations (→0040), three-layer invariant, `lib/data` modules, DB-pool reliability |
| [architecture/platform.md](architecture/platform.md) | REST · mobile auth · OAuth 2.1 AS · MCP (146 tools, profiles, confirmations) · AI engine · integrations · cron schedule (14) |
| [architecture/pm-app.md](architecture/pm-app.md) | The PM surface — board/gantt/canvas/vault/velocity/realms/notes/theming + state stores + feature inventory |
| [architecture/mobile.md](architecture/mobile.md) | The Expo / React Native companion app — Google login slice + resume/handover steps |
| [architecture/hangar.md](architecture/hangar.md) | **AI Hangar + Aeon OS** — missions on cards, §2b autopilot (stall reconciler, requeue, plan-first, answer & relaunch, follow-ups), the kairos-worker runner, REST/MCP session surfaces, the independent-review PASS gate, receipts, known gaps; §7 the external research harnesses that share the Hangar's fleet limits (canonical docs in `swarm_ai_quant/docs/harness/`) |
| [architecture/inventory-and-gaps.md](architecture/inventory-and-gaps.md) | Feature-inventory pointers + known gaps & technical debt |
| [docs/aeon-living-world.md](docs/aeon-living-world.md) | **Living world** — the freshness check (`npm run freshness`): model registry age, retired terms in guides/docs, architecture lag, version drift, dependency report |
| [architecture/history.md](architecture/history.md) | Recent-changes trail (append-only) |

**Vorath brain (formerly Kairos)** — [`architecture/kairos/`](architecture/kairos/)

| File | Covers |
|---|---|
| [architecture/kairos/overview.md](architecture/kairos/overview.md) | The brain end to end — substrate → capture → synthesis → Aether → chat; how info gets compartmentalized |
| [architecture/kairos/memory-and-capture.md](architecture/kairos/memory-and-capture.md) | `memories` substrate, all capture paths (incl. the session-capture hook), shared standing ranker, memory engine, beliefs, constitution |
| [architecture/kairos/synthesis.md](architecture/kairos/synthesis.md) | Archetypes → cortex → Aether → Briefer → daily message, thinking queue, weekly review, drift probes, the cron cadence |
| [architecture/kairos/chat.md](architecture/kairos/chat.md) | Chat Visor (incl. `undo_kairos_change`) · Telegram + chat routine · Aether · Kairos Asks · Dialogue · Sentinel · planned mobile chat |
| [architecture/kairos/mind.md](architecture/kairos/mind.md) | **One coherent mind (0.20–0.28)** — today log, daytime thinking, stage, character check, cold read, surprise, dreams, idea-contest extensions, the moment seam, the Vorath rename, Living Dominions, What Vorath knows + private-topic hold, card sorting, state keys and read tools |

---

## 1. Overview

Aeon is a project-management web application built as an npm-workspaces monorepo (`apps/web` +
`apps/mobile` + `apps/desktop` + `apps/kairos-worker` + `packages/shared`). The stack is
**Next.js 16** (App Router, React Compiler, Partial Prerendering) with **TypeScript**,
**PostgreSQL** via **Neon** serverless driver, **Drizzle ORM**, **Zustand**, **NextAuth v5**,
**Tailwind**, and **Framer Motion**. PM surfaces: kanban board (virtual scrolling), Gantt, canvas
whiteboard, trophy/vault archive, velocity analytics, 151 theme presets, real-time **Pusher** sync
(30s polling fallback), a PWA, and a Tauri desktop scaffold (parked). A 145-tool **MCP server** +
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
- **Workers** — `apps/kairos-worker` (spawn primitive); Vercel cron (12 jobs); Claude Max routines defined in code (Kairos brain hourly, Kairos chat, Kairos pulse).
