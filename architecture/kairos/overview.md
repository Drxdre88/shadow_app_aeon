# Kairos — The Brain, End to End

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md) · [chat](chat.md)

Kairos is Aeon's memory-and-cognition layer: a user-scoped substrate of `memories`,
captured from many sources, consolidated nightly into a layered self-model, and served back
as grounded context to the operator and to AI assistants. This is the mental model from
substrate up to chat. Lieutenant detail lives in [chat.md](chat.md). Kairos is versioned as
its own product: **0.15.0 "Creativity"** (`lib/kairos/version.ts:3`; app `APP_VERSION 0.32.0`,
`lib/version.ts:6`). Era history is in `docs/kairos/CHANGELOG.md`: 0.13 "Beliefs and Strategy",
0.14 "Ground and Protect", 0.15 "Creativity". Its guaranteed daily voice is the **daily message**
at 08:00 Europe/London ([synthesis.md](synthesis.md)). Retired: the 18:00 Evening Digest and the
`memory-compaction` stub cron. Retiring (behind a flag): raw nightly introspection.

> **Conceptual frame (2026-06-27):** the operator talks to **Kairos** (the entity); **Aether**
> is his super-brain — the apex self-model above ALL Dominions. Kairos draws on Aether to pull
> what's needed across every Dominion and to compartmentalize new information into the right one.

## The conceptual hierarchy

Kairos is a *heterarchy*, not a folder tree — layers emerge from meaning and re-form as the
corpus shifts (`docs/kairos/26-cognitive-hierarchy-and-consolidation.md`):

| Tier | What it is | Status |
|---|---|---|
| **Memory** | one captured thing (a row in `memories`) | substrate |
| **Episode** | one session's memories | implicit (a `session_summary`) |
| **Concept** | a semantically coherent cluster | shipped (Sunday `concept` jobs, cosine ≥ 0.82) |
| **Dominion** | a whole strand of work | shipped |
| **Constellation** | a family of Dominions | later |
| **Worldview / Aether** | global self-model across everything | shipped (Aether) |

## How a piece of information flows in and gets compartmentalized

Every inbound write lands through `captureMemory()` → `createMemory()` (`apps/web/src/lib/data/memories.ts`).
At write time three things happen:
1. **Dominion resolution** — `resolveDominionForMemory()` (`lib/data/dominions.ts`) picks the
   home Dominion in strict order: `explicit dominionId` ?? `project.dominionId` ?? `dominionRepos`
   via `sourceMetadata.repo` ?? **content-based auto-filing** (cosine vs cortex centroids) ?? `null`.
2. **Stream classification** — the `streamClass` axis (`lib/kairos/streamClass.ts`) tags the
   cognitive layer and stamps a provenance `confidence` prior.
3. **Origin labelling (0.14)** — `sourceMetadata.origin = { kind, via? }` is set by *how the row
   arrived*. Kinds are operator / activity / agent / kairos / external (`lib/kairos/origin.ts:10`),
   with trust 1 / 0.8 / 0.7 / 0.5 / 0.3 (`:24`). Senders can't set it. A derived row takes the
   **lowest** trust of its inputs, so external content can't be laundered through Kairos's own
   summaries. Unlabelled legacy rows are inferred (`inferOriginKind` `:53`).

A memory has ONE home Dominion (the FK) but can be *referenced* by any number of them through soft
`dominion:<uuid>` tags (`lib/kairos/dominionTags.ts`).

## The layers

**Substrate.** The `memories` table is the single user-scoped store: title / `aiTitle` /
`summary` / `execSummary[]` / `bodyMd`, a `type` discriminator, the `streamClass` axis,
`confidence`, a nightly `standing` score, `embedding vector(1024)`, supersession and bi-temporal
columns, `pinned`, `archivedAt`, `sourceMetadata.origin`, and a typed-edge `links` graph. FTS +
pgvector HNSW make it hybrid-searchable. See [memory-and-capture.md](memory-and-capture.md).

**Capture (ingress).** Information arrives through:
- **auto-capture** of board/project events and the nightly **project-snapshot** / board-feed pages;
- **quick capture** + `POST /api/v1/memories/capture`;
- the **coding-agent session-capture hooks** (Claude Code, Codex, Copilot CLI → `session_summary`);
- **reflections** (`kairos_reflect`, the operator's high-weight signal);
- **chat distillation** (the day's chats, Telegram included → operator reflections);
- Kairos's own staged proposals: the **idea tournament** survivors (0.15) and, until retired, raw
  **introspection**.

**Synthesis (consolidation).** Nightly, the substrate is distilled upward:
- **archetypes** (3–7 per Dominion) → the per-Dominion **cortex** → **Aether** (one global self-model);
- then the **idea tournament** (generate → novelty gate → judge → Elo → ≤3 survivors);
- in the morning, the **Briefer** writes one advisory per Dominion, grounded in its cortex, an
  Aether digest and the conscience block.

Cortex, Aether and the idea, belief, drift, review and daily-message kinds run as **thinking jobs**
that Claude Max routines claim; the paid BYOK key is the fallback. See [synthesis.md](synthesis.md).

**Kairos 0.11–0.15 layers.**

| Layer | What it adds | Detail |
|---|---|---|
| Memory engine | nightly Merge → Weigh → OwnMind → Recheck → BackUp → Concepts; `standing`; every change undoable via `memory_ops` | [memory-and-capture.md](memory-and-capture.md) §7 |
| Thinking queue | 11 job kinds (`thinking/registry.ts:16`; `PLAN_ORDER` `queue.ts:44`) claimed by the Kairos thinking / ideas / morning routines; hourly sweep plans + paid-key fallback | [synthesis.md](synthesis.md) |
| Beliefs — two minds | aligned (operator) vs own (Kairos) beliefs, weekly `mind_compare` | [memory-and-capture.md](memory-and-capture.md) §8 |
| Ground & protect (0.14) | origin labels; belief `sourceType` + confidence cap computed server-side from provenance origins (operator 0.95, tool 0.8, inference 0.6; `beliefs/support.ts`); inference can't replace operator/tool beliefs; **Recheck** flags beliefs whose sources were deleted, archived, invalidated or superseded, ×0.7 confidence, for the next `belief_extract` (`engine/steps/recheck.ts`) | docs/kairos/34 §8 (not yet in memory-and-capture) |
| Constitution + drift | one live constitution, operator-only amendments, 24 drift probes | [memory-and-capture.md](memory-and-capture.md) §9 |
| Conscience (0.14) | principles + top held beliefs injected into chat, daily message, weekly review and BRIEF (`conscience-context.ts`); nightly honesty self-checks `drift_probe:<day>:conscience`, measurement only | [synthesis.md](synthesis.md) |
| Idea tournament (0.15) | nightly `idea_generate` → `idea_judge`; ≤3 survivors as Kairos-origin inbox proposals; outcomes feed tomorrow's generator; weekly diversity alarm | [synthesis.md](synthesis.md), docs/kairos/35 |
| Daily message + weekly review | 08:00 London voice with "Idea of the day" and self-check failures; Monday review with ideas, lessons, diversity and a belief diff | [synthesis.md](synthesis.md) |

**Who thinks (01/10).** The Max-plan routines on claude.ai (Opus 5.5, Aeon connector only) are:
*Kairos thinking* (02:40Z), *Kairos ideas* (03:35Z) and *Kairos morning* (06:30Z), plus the
older Sonnet *kairos-brain-tick* (06/11/17Z), which speaks first. The paid BYOK key still runs
briefer, introspection, contradiction-scan, archetype-synthesis, chat-distill, ask-mine and
micro-consolidate directly, and covers any unanswered thinking job. Details and trigger ids are in
[synthesis.md](synthesis.md).

**Retrieval.** `retrieveContext()` (`lib/kairos/retrieve.ts`) is the canonical Dominion-scoped
fetch: the Dominion bundle + live cortex + live archetypes + top substrate (FTS+vector RRF →
confidence/standing decay → rerank-2.5) + recent traces. `retrieveGlobalContext()` is the
**whole-brain** variant (Aether stands in for cortex) that grounds unanchored chat. `prepareContext()`
packs a budget-bounded bundle for any AI window. Recipes that declare `aether`/`belief`/`constitution`
also get Aether + conscience grounding from the dispatcher (`dispatch.ts:57`).

**Conscience.** At answer time Kairos reads the operator's norms: the live constitution's
principles and the weightiest held beliefs (*you hold* vs *Kairos's own view*). It is told to say so
out loud when a reply would conflict with them. The block is delimited reference data, ≤12+12
items and ~1.5k tokens, and an empty string on read failure (`conscience-context.ts:59`, `:142`).
It is never shown to the drift or conscience probes, which measure Kairos against these norms.

**Reflection / ask / dialogue.** Beyond passive capture, Kairos initiates:
- **Kairos Asks** pick the single proactive question worth interrupting for (from Aether's tensions);
- **Dialogue** runs a multi-turn grounded conversation seeded by a pending ask, then distils it
  into reflections;
- **ideas** arrive as inbox cards (claim, why, next step, why it survived). Accepting or dismissing
  one is recorded (`proposal-accept.ts:32`) and teaches the next night's generator.

See [chat.md](chat.md).

**Chat + autonomy.** The **Visor** is a whole-brain chat by default: the operator talks to Kairos,
who uses **Aether** for grounding and the **conscience block** for his norms
(`chat-turn-assistant.ts:257`). The same turn engine powers **Telegram** (two-way; a Max-plan
*Kairos chat* routine exists behind `KAIROS_TELEGRAM_ROUTINE=1`). The **brain-tick** routine lets
Kairos speak first through `/api/v1/kairos/speak` (Will inbox + Telegram, server-throttled). Of the
four lieutenants only **Sentinel** remains. Detail in [chat.md](chat.md).

## Layering diagram
