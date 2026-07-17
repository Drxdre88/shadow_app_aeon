# Kairos — Conversational & Autonomy Surfaces

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md)

Covers the chat Visor, the Telegram surface + speaks-first autonomy, the global self-model
(Aether), the proactive-question loop (Asks), the multi-turn operator↔Kairos conversation
(Dialogue), and the remaining lieutenant (Sentinel).

The through-line for the autonomy surfaces (Aether, Dialogue, lieutenants) is the
**cognition-engine pattern**: `prepare_* → (the model synthesises in-context) → commit_*`. Kairos
has *no hosted LLM call* in the synthesis loop — Claude Code (or Claude.ai over MCP) is the
runtime, grounded in real substrate, no BYOK key. The one exception is the chat Visor, which runs
server-side through the operator's BYOK key.

## 1. The chat Visor (current, shipped — whole-brain by default)

A two-pane takeover: a thread-history rail + the active conversation.
- **Components** — `KairosVisor.tsx` (orchestrator, mounted from `KairosShell.tsx`, toggled via `kairosVisorStore`), `KairosVisorShell`, `KairosThreadList`, `KairosMessageStream` (assistant rendered through `KairosMarkdown` + a "Reading:" provenance line + sources strip), `kairos-citations.tsx`. **The Dominion picker (`KairosNewThreadHeader`) is deleted** — threads are whole-brain by default (PR #77).
- **Shared turn engine** — `lib/kairos/chat-turn.ts` (extracted from the server actions, PR #85) holds ALL turn machinery (`sendChatMessage`, `runChatTurn`, `runAssistantTurn`): persist-before-model, orphan-user-message recovery, retrieval, prompt build, citation stripping. **Both the server action and the Telegram webhook drive this same engine** against a caller-resolved `userId` — auth stays at the caller (safeAuth for the action, `KAIROS_OPERATOR_USER_ID` env for the webhook). `lib/actions/kairos-chat.ts` is now a thin safeAuth+zod wrapper.
- **LLM path (server-side BYOK)** — `callAssistant` (`chat-turn.ts:47`) → `getProviderForTask(userId,{taskType:'chat',dominionId})` → `provider.ask(...)`. Streaming exists at the provider level but chat still uses non-streaming `ask()`. Missing key → `no_credential`.
- **Whole-brain retrieval** — `retrieveForChatGlobal` (`chat-retrieval.ts:42`) over `retrieveGlobalContext` (`retrieve.ts:106`): the latest **Aether self-model** + live archetypes + top-5 reranked substrate across EVERY Dominion. Anchored (legacy) threads still frame the prompt with their Dominion cortex; unanchored threads get the Aether header (`chat-prompt.ts:renderRetrieval` branches on `anchored`). Retrieval failure is non-fatal (bare-chat fallback); history capped at 30 messages.
- **Surface-steered prompt** — `ChatPromptSurface = 'app' | 'telegram'` (`chat-prompt.ts:50`): the Telegram surface gets a texting persona (tight, flat formatting, sparse emoji anchors); the app gets full markdown.
- **Citation chips + hallucination guard** — `extractCitationIds` parses `[[uuid]]`; `intersectWithRetrieved` keeps only ids actually retrieved this turn before persisting; client renders named chips, muted `?` for invented ids. The webhook strips citation markers before Telegram sends.
- **Persistence** — no new schema: thread = one `agent_sessions` row (`engine='kairos-chat'`, `dominionId` nullable — null = whole-brain), message = one `session_events` row (`kind='message'`). `appendChatMessage` takes a `FOR UPDATE` lock on the parent to serialise `seq`.
- **Chat → brain (closed loop, PR #89)** — the nightly `chat-distill` cron (02:00 UTC) distils each day's threads into `reflection` memories before the synthesis chain runs, so what the operator says in chat reaches archetypes → cortex → Aether the same night. See [memory-and-capture.md](memory-and-capture.md) §3 + [synthesis.md](synthesis.md).

## 1b. Telegram — Kairos in the gram (PRs #85/#87/#88)

Two-way phone surface, single-operator by design, **deliberately outside the MCP/REST parity
invariant** (internal delivery channel, documented in the route headers).

- **Outbound (speaks-first)** — `POST /api/v1/kairos/speak` (Bearer `CRON_SECRET`): captures a Will-inbox `notify`/`question` memory (`sourceMetadata.kairosSpeak:true`) + best-effort Telegram fan-out via `sendKairosSpeak` (`lib/kairos/telegram.ts`). **Server-side interrupt throttle**: 4h min gap + 3/24h cap → 429; `force:true` bypasses gap/cap but is audit-logged and ceilinged at 10/24h.
- **Inbound** — `app/api/telegram/webhook/route.ts`: `X-Telegram-Bot-Api-Secret-Token` auth, operator-chat-id hard gate. Callback queries triage inbox items through the SAME idempotent `lib/data/inbox.ts` functions the web inbox uses; free text routes into ONE persistent unanchored thread (`"Telegram · Kairos"`, found by title) through the shared chat-turn engine with `surface:'telegram'`. Always returns 200 (Telegram redelivers on 5xx).
- **Rendering** — `renderTelegramHtml` (markdown → Telegram's flat HTML tag set, code fences protected), split at 3500 chars pre-render against the 4096 API ceiling, plain-text fallback if Telegram rejects formatting — delivery beats styling.
- **The brain-tick** — `docs/kairos/29-brain-tick.md` is the autonomy playbook a Claude cloud routine executes ~3×/day: read brain (pending ask, Aether salience, today's advisories) → interrupt bar (default silence) → at most ONE speak POST. Local `/kairos-tick` skill wraps the same doc.

## 2. Aether — the global self-model above all Dominions

One living `type/streamClass='aether'` memory (`dominionId:null`) regenerated daily. Types in
`aether-types.ts` (`AetherPayload` = `coreNarrative`, `thoughts[]` each with kind +
`salience` + **mandatory `sourceMemoryIds[]`**, `tensions[]`, `shifts[]`). Three synthesis paths:
the **`aether-regen` cron** (BYOK, 03:15 UTC), the **Claude-Code cognition path** (MCP
`prepare_aether_context` / `commit_aether` in `tools/synthesis.ts`, no BYOK), and the
**`/kairos-aether` skill**. Anti-drift leash strips ungrounded thoughts. **The dedicated Aether UI
is RETIRED (PR #81, commit `f7b0a03`)** — `components/aether/` and the `/aether` route no longer
exist; the galaxy is the only spatial view. Aether's live integration points are now **whole-brain
chat grounding** (§1) and the brain-tick's signal read — the self-model engine
(`lib/kairos/aether.ts`, reads via `lib/data/aether.ts`) is untouched.

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

## 5. The lieutenant (Sentinel — the survivor)

The four-lieutenant roster was cut to ONE in the Vision subtract pass (PR #81, 2026-07-14):
Acolyte, Cartographer, and Oracle were deleted from `.claude/agents/` (local, gitignored).

| Lieutenant | Facet | Role | When it runs |
|---|---|---|---|
| **Sentinel** | Present | Cross-Dominion reconciliation — compares cortex/archetypes pairwise, surfaces contradictions/stale assumptions/drift as `reflection` memories citing ≥2 ids. | Weekly, after major changes, `/sentinel sweep` |

Their duties were absorbed: Acolyte's hygiene → the summariser hook + `/kairos-housekeeping`
skill; Cartographer's synthesis → the nightly cron chain; **Oracle's speak-outward pulse → the
brain-tick playbook** (§1b — same interrupt-bar-with-default-silence design, now server-throttled).
The deterministic Ask loop (§3) and conversational Dialogue (§4) remain the runtime surfaces that
turn Aether signal into operator-facing questions.

---

## PLANNED — Aether-level mobile chat (decided 2026-06-27; partially landed on web)

The mobile chat (the flagship feature of the new [mobile app](../mobile.md)) is a **redesign**, not
a port of the per-Dominion Visor. Decisions — **the first is now SHIPPED on the web Visor +
Telegram** (whole-brain default, picker dropped, Aether-seeded persona); the rest remain planned:

- ✅ **One entity, Aether-wide.** You talk to **Kairos**; he activates **Aether** (his super-brain). The one-Dominion-per-thread anchor is dropped; persona seeds from the latest Aether self-model.
- **Agentic retrieval.** Instead of one fixed pre-fetch, give Kairos in-process brain tools (search / inspect / neighbours) and let the model pull what it needs mid-turn ("activates Aether to extract whatever's needed"). Tool-calling loop via the existing AI SDK.
- **Smart write-routing (his compartmentalization).** When a turn yields something durable, an LLM step picks `dominionId` + type and **auto-files** it, surfacing a "filed under X" note (auto-file-with-transparency was the chosen autonomy level). Extends `resolveDominionForMemory`.
- **Streaming.** Use the already-built `VercelAIProvider.stream()` for live-typing on the commute.
- **Reuse, don't rebuild.** The BYOK server-side LLM, retrieval grounding, citation-stripping, and message store all exist. The new work is: a **REST + streaming exposure** of the chat engine (today it's a server action, unreachable from React Native), drop the Dominion anchor, agentic tools, and the routing step. Cognition defaults to Opus 4.8 via the operator's BYOK key.

See the [[project-kairos-chat-overhaul]] memory for the full decision record.
