# Kairos — Conversational & Autonomy Surfaces

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md)

Covers the chat Visor, the global self-model (Aether), the proactive-question loop (Asks), the
multi-turn operator↔Kairos conversation (Dialogue), and the four lieutenant agents.

The through-line for the autonomy surfaces (Aether, Dialogue, lieutenants) is the
**cognition-engine pattern**: `prepare_* → (the model synthesises in-context) → commit_*`. Kairos
has *no hosted LLM call* in the synthesis loop — Claude Code (or Claude.ai over MCP) is the
runtime, grounded in real substrate, no BYOK key. The one exception is the chat Visor, which runs
server-side through the operator's BYOK key.

## 1. The chat Visor (current, shipped)

A two-pane takeover: a thread-history rail + the active conversation.
- **Components** — `KairosVisor.tsx:35` (orchestrator, mounted from `KairosShell.tsx:77`, toggled via `kairosVisorStore`), `KairosVisorShell`, `KairosThreadList`, `KairosMessageStream` (assistant rendered through `KairosMarkdown` + a "Reading:" provenance line + sources strip), `KairosNewThreadHeader` (Dominion picker), `kairos-citations.tsx`.
- **Server actions** — `lib/actions/kairos-chat.ts`: `startKairosThread` (`:90`), `sendKairosMessage` (`:109`, with orphan-user-message recovery), `listKairosThreads`/`loadKairosThread`/`archiveKairosThread`. Invariant: **persist the user turn BEFORE the model call** (`:144`) so a failure never loses input.
- **LLM path (server-side BYOK)** — `callAssistant` (`:58`) → `getProviderForTask(userId,{taskType:'chat',dominionId})` → `provider.ask(...)`. **Streaming exists at the provider level (`provider.ts:66` `stream()`) but the chat action currently uses non-streaming `ask()`.** Missing key → `no_credential`.
- **Memory-grounded retrieval** — `retrieveForChat` (`chat-retrieval.ts:29`) over `retrieveContext`: cortex + live archetypes (≤10) + top-5 hybrid substrate. Failure is non-fatal (falls back to bare chat). Injected as a system-prompt prefix (`chat-prompt.ts`); history capped at 30 messages.
- **Citation chips + hallucination guard** — `extractCitationIds` parses `[[uuid]]`; `intersectWithRetrieved` keeps only ids actually retrieved this turn before persisting; client renders named chips, muted `?` for invented ids.
- **Persistence** — no new schema: thread = one `agent_sessions` row (`engine='kairos-chat'`), message = one `session_events` row (`kind='message'`). `appendChatMessage` takes a `FOR UPDATE` lock on the parent to serialise `seq`.
- **Constraint:** a thread is **anchored to exactly ONE Dominion** (`createChatThread` requires `dominionId`). There is no Aether-level / cross-Dominion chat surface today.

## 2. Aether — the global self-model above all Dominions

One living `type/streamClass='aether'` memory (`dominionId:null`) regenerated daily. Types in
`aether-types.ts` (`AetherPayload` = `coreNarrative`, `thoughts[]` each with kind +
`salience` + **mandatory `sourceMemoryIds[]`**, `tensions[]`, `shifts[]`). Three synthesis paths:
the **`aether-regen` cron** (BYOK, 03:15 UTC), the **Claude-Code cognition path** (MCP
`prepare_aether_context` / `commit_aether` in `tools/synthesis.ts`, no BYOK), and the
**`/kairos-aether` skill**. Anti-drift leash strips ungrounded thoughts. View: `/aether` redirects
into `/kairos` with the Aether lens; components under `components/aether/` (`AetherView`,
`Aether3D`, `AetherOverlay`, `scene/`). Engine: `lib/kairos/aether.ts`; reads via `lib/data/aether.ts`.

## 3. Kairos Asks — the proactive one-question loop

A deterministic (no-LLM) layer **above Aether** that selects the single question worth interrupting
with. Selection (pure, `ask-select.ts`): candidates from Aether `thoughts` of kind `question`/`tension`
+ `tensions[]`, scored by salience (+persistence boost), filtered by `DEFAULT_BAR=0.78`, with a
`MIN_INTERVAL_HOURS=20` cadence floor. Orchestration (`ask.ts`): `runKairosAsk` (never stacks two;
requires a latest Aether), `answerKairosAsk` (writes the answer as a **reflection** anchored to the
question's Dominion). MCP: `run_kairos_ask`, `get_pending_kairos_ask`, `answer_kairos_ask`
(`tools/ask.ts`). Storage: `kairos-ask` advisory memories (`lib/data/ask.ts`).

## 4. Kairos Dialogue — the multi-turn operator↔Kairos conversation

The conversational successor to the one-shot Ask: a pending ask (or free topic) opens a threaded,
retrieval-grounded back-and-forth that Claude Code authors turn-by-turn (no BYOK), then distils into
durable reflections. Persistence reuses `agent_sessions` (`engine='kairos-dialogue'`) +
`session_events` (roles `operator`/`kairos`); null-Dominion dialogues allowed. Orchestration
(`lib/kairos/dialogue.ts`): `openKairosDialogue`, `prepareDialogueContext` (fresh per-turn retrieval
when Dominion-anchored), `appendDialogueTurn`, `commitDialogue` (distils → reflections, closes ask +
thread). **Soft Dominion tagging:** `commitDialogue` accepts `dominionIds[]` written as
`dominion:<id>` reference tags — prefer tagging over hard pinning. MCP: `open_dialogue`,
`prepare_dialogue_context`, `append_dialogue_turn`, `get_dialogue`, `commit_dialogue`. Driver: the
`/kairos-dialogue` skill. Handover: `docs/kairos/28-handover-2026-06-15-dialogue-and-soft-tagging.md`.

## 5. The lieutenants

Four Claude-Code subagents (`.claude/agents/`), each owning a temporal facet; all read-mostly over
the `aeon` MCP, write structured memories, and end each run with a `trace` memory.

| Lieutenant | Facet | Role | When it runs |
|---|---|---|---|
| **Acolyte** | Past | Memory hygiene — drains the summary backlog (backfills `execSummary`+`aiTitle`), flags dupes/orphans. Does not synthesise. | Session-end, backlog growth, `/acolyte sweep` |
| **Sentinel** | Present | Cross-Dominion reconciliation — compares cortex/archetypes pairwise, surfaces contradictions/stale assumptions/drift as `reflection` memories citing ≥2 ids. | Weekly, after major changes, `/sentinel sweep` |
| **Cartographer** | Timeless | The only one that synthesises net-new structure — regenerates cortex + recasts archetypes per Dominion (opus). | Nightly, after major changes, `/cartographer rebuild` |
| **Oracle** | Future | The only one that speaks outward — on a tick decides whether to interrupt; if warranted writes one surgical `advisory` (question) + push. Default = no. Throttle ≤1/4h. | One pulse per invocation (routines schedule it) |

The deterministic Ask loop (§3) and conversational Dialogue (§4) are the runtime surfaces that turn
Oracle/Aether signal into operator-facing questions.

---

## PLANNED — Aether-level mobile chat (decided 2026-06-27)

The mobile chat (the flagship feature of the new [mobile app](../mobile.md)) is a **redesign**, not
a port of the per-Dominion Visor. Decisions:

- **One entity, Aether-wide.** You talk to **Kairos**; he activates **Aether** (his super-brain). Drop the one-Dominion-per-thread anchor (§1's constraint). Seed Kairos's persona from the latest Aether self-model, not a single Dominion cortex.
- **Agentic retrieval.** Instead of one fixed pre-fetch, give Kairos in-process brain tools (search / inspect / neighbours) and let the model pull what it needs mid-turn ("activates Aether to extract whatever's needed"). Tool-calling loop via the existing AI SDK.
- **Smart write-routing (his compartmentalization).** When a turn yields something durable, an LLM step picks `dominionId` + type and **auto-files** it, surfacing a "filed under X" note (auto-file-with-transparency was the chosen autonomy level). Extends `resolveDominionForMemory`.
- **Streaming.** Use the already-built `VercelAIProvider.stream()` for live-typing on the commute.
- **Reuse, don't rebuild.** The BYOK server-side LLM, retrieval grounding, citation-stripping, and message store all exist. The new work is: a **REST + streaming exposure** of the chat engine (today it's a server action, unreachable from React Native), drop the Dominion anchor, agentic tools, and the routing step. Cognition defaults to Opus 4.8 via the operator's BYOK key.

See the [[project-kairos-chat-overhaul]] memory for the full decision record.
