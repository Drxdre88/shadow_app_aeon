# Kairos Companion — Session Handover

**Last updated:** 24/05/2026
**Active branch:** `feature/kairos-companion` (BYOK merged as `e7d9fa3`)
**Working state:** clean, typecheck passing
**Purpose of this doc:** Pick up scoping or implementation without re-reading the originating conversation.

---

## What this is in one paragraph

Kairos is a **persistent, opinionated companion** to a superhuman operator who commands a vast field of work across multiple realms / projects / repos. It sits *above* the agent market (Claude Code, Codex, company AI, future engines) and holds the union of work in attention so the operator can stay where they're irreplaceable. The companion is **event-driven, not a 24/7 loop** — inference fires on triggers (voice, cron, webhook, session events). It dispatches across whichever AI subscription/API is currently cheapest via an **Engine Router seam**. The visual orb-graph + voice loop is its **cognition surface and competitive moat**, not chrome. Aeon (the host app) is the substrate; Kairos lives inside it.

---

## Five non-negotiables for the companion

1. **One entity** — many engines, one voice
2. **Ambient, not invoked** — pulsing pill, always-on phone, never closed
3. **Defends your time** — discretion is first-class; interrupts only when it must
4. **Models you** — preferences, patterns, fatigue, loyalties accumulate
5. **Takes initiative** — opinionated, can interject

Lose any of these and it becomes a different product.

---

## Locked architectural decisions

| Decision | Detail |
|---|---|
| **Companion = persistent but event-driven** | Not a 24/7 loop. Triggers (voice, cron, webhook, session event) call Engine Router → one inference → action. Idle = zero spend. |
| **Engine Router is the seam** | Per-task choice of engine based on task type, sensitivity, urgency, current quota/cost. Engines are a market. Kairos persists; engines swap. |
| **No engine is structurally load-bearing** | Removing any engine (incl. company AI) only changes the bill, not the companion's behaviour. Test: companion still works if engine X disappears. |
| **Dominion ⊥ Realm** | Dominion = ontological axis (what part of life this is). Realm = social axis (who can see). Soft-coupling via `workspaceGroups.default_dominion_id` later — not forced. |
| **Memory layer is the substrate, not a feature** | Everything Kairos hears/says lives in `memories`. Inbound, outbound, decisions, advisories, sessions, snapshots all become typed memories. |
| **Aeon evolves; Kairos remains** | App stack and engines change. The companion shape (graph, voice, model-of-you, engine-router) stays. |
| **UI is the cognition surface, not chrome** | Orb-graph = situational awareness. Voice loop = presence. Direct manipulation editing = training loop. These are co-equal with backend. |

---

## Engine substrate — current map

| Layer / Use | Engine | Why | Source/Cost |
|---|---|---|---|
| **Persistent inference (briefings, advisories, classifiers)** | Claude Opus 4.7 (heavy) / Sonnet 4.6 (default) / Haiku 4.5 (classifier) via BYOK | Quality + 1M context; dedicated budget so it doesn't compete with interactive work | BYOK API, **$30–80/mo expected, $50 soft cap / $75 hard cap recommended** |
| **Orchestration decisions (plan steps, monitors)** | Routed cheap: Gemini Flash-Lite (free tier) → OpenRouter cheap → STAF | High-volume, decision-quality is adequate, free tier covers most | ~$5–15/mo |
| **Interactive code execution (cognition tasks)** | Claude Code (Max subscription) | Already paid; nuance + 1M context + safety defaults | $200/mo (already paying) |
| **Volume code execution (shell, long /goal, batch)** | Codex CLI (Codex Pro subscription) | Token-cheap, 7+hr autonomous, parallel subagents | $100/mo (already paying) |
| **Free volume backend** | Codex with `OPENAI_BASE_URL` → STAF / OpenRouter | Zero marginal cost for batch + rollups | $0 |
| **Adversarial review** | `codex-plugin-cc` inside Claude sessions | Different model architecture = independent verification | $0 marginal |
| **Sensitive code/IP** | Local Ollama (Qwen 3.5 or Gemma 4) | Privacy; no data leaves machine | $0 |
| **Burst overflow** | Anthropic Haiku via BYOK | Last resort when subs throttled | Per-token, capped |

**Total incremental over current $300/mo subscriptions: $30–80/mo for the BYOK persistent layer + ~$5–15 for orchestration cheap-route.**

### AIProvider abstraction to mirror

`shadow_dev_lab/packages/sl-shadow-ai/src/sl_shadow_ai/provider.py` defines a clean Python ABC: `AIProvider` with `ask()` + `stream()` returning vendor-neutral `AIResponse` + `StreamChunk` envelopes. Port directly to TypeScript at `apps/web/src/lib/ai/provider.ts` — same shape, different language. The existing `lib/ai/router.ts` from the BYOK merge already covers Anthropic/OpenAI/Google; extend with OpenRouter, Gemini direct, STAF (HTTP), and Ollama providers.

---

## What's saved as durable specs

| File | What |
|---|---|
| `00-master-plan.md` | Full schema, 10-phase build, orchestration tower (Section 0.5), risks, parallel tracks |
| `01-codex-integration-strategy.md` | Codex's three slots (in-session via plugin, spawned peer, batch fan-out), benchmark matrix, routing table |
| `02-buildable-25.md` | **The actionable list — 25 tickets in 6 groups, with critical-path-5 minimum-viable set** |
| `HANDOVER.md` | This document |

**For next session: start at `02-buildable-25.md`.** The master plan and Codex strategy are reference; the 25-element list is the work surface.

---

## Recommended starting work (critical-path 5)

If forced to ship the smallest set that gives a working event-driven companion (~1 week AI-accelerated):

1. **A1** — Extend `memories.type` enum (snapshot, decision, inbound, advisory, achievement, session_event, fact, contact, external_event)
2. **A2** — `POST /api/v1/memories/capture` generic capture endpoint
3. **B6 + B10** — TypeScript `AIProvider` ABC + Engine Router with policy seeds (one provider is enough — Gemini Flash-Lite via BYOK)
4. **C11 + C12** — Dominion vision + objectives schema + `inspect_dominion()` MCP tool
5. **E20** — Briefer cron (7am daily per Dominion → router → BYOK → advisory memory)

After that ships, the companion captures broadly, has standing context, and briefs you each morning. Everything else compounds.

---

## Open scoping questions (the user wants to chew on these more)

These are explicitly **not decided yet**:

- [ ] **Plans as a separate concept vs just Dominion objectives + sessions** — wait until Briefer + spawn primitive prove their value; might find a separate Plans table is unnecessary
- [ ] **Voice loop UX shape** — push-to-talk vs always-listening; brand voice (ElevenLabs/Cartesia) vs browser-native TTS; mobile live-activity design
- [ ] **Channel adapter priority order** — Teams in first? GitHub webhook first? Slack first? Decide by what actually arrives most often
- [ ] **Model-of-you privacy posture** — single-user only initially is locked; team mode shape is open
- [ ] **Trophy rollup granularity** — theme vs temporal vs milestone (or hybrid); whether Mem0 wraps it or bespoke prompt
- [ ] **In-graph edit UX** — drag-Dominion-onto-memory is locked; what other gestures matter is open
- [ ] **Mobile presence design** — live activity widget vs persistent notification vs full-screen pill
- [ ] **A2A protocol adoption** — only when 3+ specialised operators run concurrently; not yet
- [ ] **Worker host topology** — dev box vs cheap VPS vs Vercel Cron + ephemeral function (cron + ephemeral is probably fine for v1)

---

## Anti-patterns / things NOT to do

Surfaced from earlier mistakes in scoping:

- **Don't build a "24/7 master brain" loop.** The companion is event-driven. There is no continuous reasoning process between triggers. Idle = zero cost. Saying "Layer 4 runs persistently" means *event-driven and always reachable*, not *token-burning loop*.
- **Don't hardwire company AI (STAF) as a structural layer.** It's a *router policy preference* for non-sensitive batch work *while employed*. If user leaves the company, the router falls through to the next cheapest engine and total cost rises by maybe $10–20. The companion's behaviour does not change.
- **Don't defer UI as "last."** Voice loop + orb-graph + direct manipulation editing are the moat. They co-evolve with backend, not after it.
- **Don't manufacture framework scale to look thorough.** Four-layer cognitive towers, named tiers, dramatic exec summaries are theatre. The user prefers tight prose with strong opinions over flow-charted slide decks. Producing length is a tell of overthinking.
- **Don't produce trailing summary recaps when the user can read the diff.** CLAUDE.md says terse; honour it.
- **Don't write CHANGELOG / VISION / ARCHITECTURE updates unless asked.** They're maintained by their own agents (`inferno-architect`, `inferno-seer`).
- **Don't add Co-Authored-By to commits.** User explicitly disallows.

---

## What changed in the workspace during this scoping session

1. New branch `feature/kairos-companion` created off `feature/cortex-swarm-port`
2. Merged `feature/brain-ai-integration` (BYOK foundation): commit `e7d9fa3`
3. Resolved one conflict in `apps/web/src/lib/db/schema.ts` (parallel type-export additions, kept both)
4. Created `inferno-specs/kairos-companion/` directory with four files (master plan, codex strategy, 25 buildable, this handover)
5. **No production code written, no migrations run.** Pure scoping + branch prep.

---

## How to start a future session cold

1. Read this file
2. `git checkout feature/kairos-companion` and `git pull` if needed
3. Read `02-buildable-25.md` for the work surface
4. Pick one of the critical-path-5 items (or whatever the user directs)
5. Honour the anti-patterns list — short prose, no framework theatre, UI co-equal with backend
6. Engine routing principle: subscriptions first (Max, Codex), API fallback (BYOK) only when subs don't fit, company AI as opportunistic policy preference (never structural)

---

## Quick reference — the principal claims

If the user (or a future AI) needs a 30-second briefing on Kairos:

- **What:** A persistent, opinionated AI companion that holds the operator's vast field of work in attention so they can stay where they're irreplaceable
- **Where it lives:** Inside the Aeon app (board / project / realm / memory layer they're building in closed beta)
- **How it thinks:** Event-driven inference dispatched by an Engine Router across Claude Max, Codex Pro, company AI, BYOK API, and local Ollama
- **What you see:** An orb-graph showing memories, sessions, Dominions as visual nodes; a voice loop; ambient sidebar pill; advisory feed
- **What you don't see:** Claude Code sessions spawned to handle tasks, orchestrators running on cheap engines, classifiers, briefers, monitors
- **Cost shape:** $30–80/mo BYOK + $5–15/mo orchestration on top of existing $300–400/mo Claude+Codex subscriptions
- **Strategic position:** Above the agent market, not competing with Anthropic/OpenAI; harness for whatever engine wins next
- **Status:** Scoped. Branch ready. BYOK merged. Critical-path-5 is ~1 week AI-accelerated to MVP.
