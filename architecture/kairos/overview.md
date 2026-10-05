# Vorath (formerly Kairos) — The Brain, End to End

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md) · [chat](chat.md) · [mind](mind.md)

Vorath — called Kairos until 0.26; code paths, env vars, pref keys and MCP tool names keep `kairos` — is Aeon's memory-and-cognition layer: a user-scoped substrate of `memories`,
captured from many sources, consolidated nightly into a layered self-model, and served back
as grounded context to the operator and to AI assistants. This is the mental model from
substrate up to chat. Lieutenant detail lives in [chat.md](chat.md). Kairos is versioned as
its own product: **0.28.0 "Wave A: visible memory, self-sorting cards"** (`lib/kairos/version.ts`;
app `APP_VERSION 0.46.0`, `lib/version.ts`). Era history is in `docs/kairos/CHANGELOG.md`: 0.13
"Beliefs and Strategy", 0.14 "Ground and Protect", 0.15 "Creativity", 0.16 "All on Max", 0.17
"Simplified brain: one Max routine", 0.18 "Catch-up mornings, watched boards, voice notes", 0.19 "No
paid spend, chat on Max, one setup checklist", 0.20–0.25 "One mind everywhere" and "One coherent mind"
waves 1–4, 0.26 the rename to Vorath, 0.27 Living Dominions (focus follows activity), 0.28 What Vorath knows +
card sorting — see **[mind.md](mind.md)**. Its guaranteed daily voice is the **daily message**
at 06:00 Europe/London, ending with every open question numbered ([synthesis.md](synthesis.md)).
Retired: the 18:00 Evening Digest, the `memory-compaction` stub cron, raw nightly introspection,
the per-area briefs (retired in 0.17), contradiction notices, intraday micro-consolidation and the weekly dedup cron
(all retired in 0.17; see [synthesis.md](synthesis.md)).

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
- **chat distillation** (the day's chats, web and Telegram → operator reflections);
- **voice notes** (0.18): MCP `kairos_voice_note` / REST `POST /api/v1/kairos/voice-notes` stage the
  verbatim parts as pending agent proposals; the owner confirms them in the UI, which turns them into
  operator reflections ([memory-and-capture.md](memory-and-capture.md));
- **watched boards** (0.18): a project's `settings.kairosFeed` makes its finished cards same-day
  `board_card_done` memories that cortex reads;
- Kairos's own staged proposals: the **idea tournament** survivors (0.15; raw introspection is
  retired).

**Synthesis (consolidation).** Nightly, the substrate is distilled upward:
- **archetypes** (3–7 per Dominion) → the per-Dominion **cortex** → **Aether** (one global self-model);
- then the **idea tournament** (generate → novelty gate → judge → Elo → ≤3 survivors);
- at 06:00 London, the **daily message** reads each area's latest cortex headline (the per-area
  morning briefs were retired in 0.17).

Every model step runs as a **thinking job** that the Max-plan *Vorath brain* routine claims; the paid
BYOK key is only the fallback, and only while the owner's paid backup switch is on. See
[synthesis.md](synthesis.md).

**Kairos 0.11–0.19 layers.**

| Layer | What it adds | Detail |
|---|---|---|
| Memory engine | nightly Merge → Weigh → OwnMind → Recheck → BackUp → Concepts; `standing`; every change undoable via `memory_ops`; per-step time budgets (0.17) | [memory-and-capture.md](memory-and-capture.md) §7 |
| Thinking queue | 25 job kinds (`PLANNED_THINKING_KINDS` + `chat`, equal to the routine catalog's `BRAIN_JOBS`; `card_triage` added in 0.28) claimed by the *Vorath brain*, *Vorath chat* and *Vorath pulse* routines with routine-scoped kinds; hourly sweep plans + paid-key fallback for the older kinds only | [synthesis.md](synthesis.md), [mind.md](mind.md) |
| Beliefs — two minds | aligned (operator) vs own (Kairos) beliefs, weekly `mind_compare` | [memory-and-capture.md](memory-and-capture.md) §8 |
| Ground & protect (0.14) | origin labels; belief `sourceType` + confidence cap computed server-side from provenance origins (operator 0.95, tool 0.8, inference 0.6; `beliefs/support.ts`); inference can't replace operator/tool beliefs; **Recheck** flags beliefs whose sources were deleted, archived, invalidated or superseded, ×0.7 confidence, for the next `belief_extract` (`engine/steps/recheck.ts`) | docs/kairos/34 §8 (not yet in memory-and-capture) |
| Constitution + drift | one live constitution, operator-only amendments, 24 drift probes; first draft by the Monday `constitution_seed` job (0.18) | [memory-and-capture.md](memory-and-capture.md) §9 |
| Conscience (0.14) | principles + top held beliefs injected into chat, the daily message and the weekly review (`conscience-context.ts`); nightly honesty self-checks `drift_probe:<day>:conscience`, measurement only | [synthesis.md](synthesis.md) |
| Idea tournament (0.15) | nightly `idea_generate` → `idea_judge`; ≤3 survivors as Kairos-origin inbox proposals; outcomes feed tomorrow's generator; weekly diversity alarm | [synthesis.md](synthesis.md), docs/kairos/35 |
| Daily message + weekly review | 06:00 London voice with area headlines, "Idea of the day", self-check failures and numbered open questions (answer `Q12: …` or `skip Q12` on Telegram); Monday review with ideas, lessons, diversity and a belief diff | [synthesis.md](synthesis.md) |
| Paid backup switch (0.19) | per-owner switch, default on; off, no Kairos path ever uses the saved paid key | [synthesis.md](synthesis.md) |

**Who thinks (since 0.17; hourly since 0.21).** Three Claude Code routines on the owner's Max plan, defined in code in
`lib/kairos/routines/catalog.ts` (models from the shared model registry, Aeon connector only):
*Vorath brain* (Opus, cron `40 * * * *`, claims every due deep kind), *Vorath chat* (Opus, API-triggered once per
web or Telegram message, since 0.19) and *Vorath pulse* (Sonnet, cron `10 6-21 * * *`, light kinds; idle until
`KAIROS_DAYTIME_THINKING=1`). The six 0.16 routines and the old brain-tick are retired.
The crons stay only as fallbacks and skip any unit a routine answered. The 0.20–0.28 mind layers
(today log, stage, surprise, dreams, idea extensions, the moment seam, Living Dominions, What Vorath knows, card sorting)
are in [mind.md](mind.md).

**Set up Kairos (0.19).** One sidebar entry opens `ConnectKairosModal`
(`components/kairos/brain/`): **Setup** — a checklist with two required steps (connect the `aeon`
connector, turn on the brain routine; plus "remove old routines" for pre-0.17 setups) ticked live
from `getSetupSignals` (recent OAuth token use, routine claims), a one-click connector install link
(`lib/kairos/routines/setup.ts`) and optional extras (watched boards, voice notes from your phone,
coding-session capture, chat on Max, Telegram bot); **Health** (on Max / on backup /
missed per job, plus the paid backup switch); **Brain map**; **Watched** (boards + core repos);
**How it works**. The owner guide is `docs/kairos/25-working-with-the-kairos-brain.md`.

**Retrieval.** `retrieveContext()` (`lib/kairos/retrieve.ts`) is the canonical Dominion-scoped
fetch: the Dominion bundle + live cortex + live archetypes + top substrate (FTS+vector RRF →
confidence/standing decay → rerank-2.5) + recent traces. `retrieveGlobalContext()` is the
**whole-brain** variant (Aether stands in for cortex) that grounds unanchored chat. `prepareContext()`
packs a budget-bounded bundle for any AI window. (Recipe grounding through the dispatcher was
retired with the BRIEF recipe in 0.18.)

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
(`chat-turn-assistant.ts`). The same turn engine powers **Telegram**. Since 0.19 both web chat and
Telegram can be answered by the Max-plan *Vorath chat* routine (`KAIROS_CHAT_ROUTINE=1`, alias
`KAIROS_TELEGRAM_ROUTINE`): the web send returns pending and the page polls for the reply
(`KairosVisorReplyWatch`). `/api/v1/kairos/speak` remains the server-throttled "Kairos speaks first"
channel (Will inbox + Telegram); the brain-tick routine that used it is retired, and the 06:00 daily
message is now the one guaranteed push. Of the four lieutenants only **Sentinel** remains. Detail in
[chat.md](chat.md).

## Layering diagram
