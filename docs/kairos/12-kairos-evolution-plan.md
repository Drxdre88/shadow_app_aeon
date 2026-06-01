# Kairos Evolution Plan — From Memory Store to Thinking Partner

**Date:** 01/06/2026
**Predecessor:** [`11-handover-2026-05-31.md`](./11-handover-2026-05-31.md) — board-sync retrospective
**Status:** Vision locked. Phase 1 ready to execute.
**Owner:** Andrey Selikhov

---

## Preamble — Why this document exists

Kairos was built as a memory cortex with strong substrate (Postgres FTS, taxonomy, edges, BYOK AI router) and weak intelligence on top of it. The cortex *stores*; nothing yet *thinks*. The recent bulk import of Aeon board tasks exposed the problem starkly: 230+ new nodes landed in the cosmic graph as a flat ocean of stars with no Dominion gravity, no tier separation, and no archetype structure. The substrate is correct; the **organising intelligence is the missing layer**.

This document is the multi-phase plan to grow Kairos from a memory store into a thinking partner — an agent with a persistent model of each Dominion, dual feedback loops with its owner, the ability to surface questions, detect drift against vision, and eventually run its own workflows under explicit gates.

The arc:
- **Phase 1 — Foundation.** Shape memory, synthesize archetypes, build Dominion cortex, wire reflections, ship chat surface.
- **Phase 2 — Active agent.** Dual feedback loops fire. Kairos prompts the user. Thinking chains run autonomously on cron and on demand.
- **Phase 3 — Identity.** Configurable Kairos personality. Multi-agent council ("board of directors").

---

## Core principles

These are non-negotiable. Everything below derives from them.

1. **The cosmic view is the soul.** Do not replace it. Add organising intelligence on top.
2. **Substrate flows up, context flows down.** New memories enrich the cortex; the cortex enriches every agent reply.
3. **Cite-grounded reasoning.** Every Kairos claim links back to substrate. No floating assertions.
4. **The owner reshapes the brain.** Reflections from the owner carry higher weight than activity-derived drift. Silence is also a signal.
5. **Autonomy is earned, not assumed.** Kairos can suggest. Kairos cannot spawn / commit / send without explicit gates.
6. **Calibration is a feature.** A morning ping that fires every day will get muted in a week. Threshold the noise floor carefully.

---

## The visual layer — the stunning view stays

The cosmic graph is the soul of Kairos. We do not touch the aesthetic. What we add is **organising intelligence** on top:

| Enhancement | What you'll see |
|---|---|
| **Dominion gravity wells** | Each Dominion becomes a soft luminous region. Memories without a dominion drift to a dim "void" zone — instantly visible that they need anchoring. |
| **Tier visibility toggle** | Default view: archetypes + repos only (~10-15 master nodes per Dominion). Click "show substrate" → underlying memories fade in, grouped under their archetype. |
| **Stream filter chips** | Top-right: `[Agentic] [Execution] [Ideas] [Reflections] [Archetypes]` — toggle what's visible. Hide execution noise when you want thinking-only. |
| **Archetype orbs** | Larger, brighter, *pulsing* nodes that distinguish synthesised from raw. Visual hierarchy = cognitive hierarchy. |
| **Edge weight = co-occurrence** | Pairings between memories that appear in the same archetype draw thicker lines. The graph starts to *show you* what's actually related. |
| **Dominion cortex orb** ⭐ | One special node per Dominion — the "consciousness orb." Size = activity, pulse rate = recent change, colour = vision-alignment. Click to open the cortex view. |
| **Reflection beacons** | Owner reflections render as distinct, bright, slightly larger nodes — visually marking them as load-bearing signals. They glow when their influence is shaping current cortex output. |
| **Time scrubber** | Bottom strip: scrub backwards to see the brain as it was last week, last month. Watch it grow. |

The graph gets *more beautiful*, not less — because density resolves into pattern.

---

## Architecture — the layers

```
                    ┌───────────────────────────────────┐
                    │   ARCHETYPE LAYER (Kairos-made)   │
                    │   3-7 master nodes per Dominion   │
                    │   e.g. "Beta launch readiness"    │
                    │   "Kairos brain build-out"        │
                    └────────────┬──────────────────────┘
                                 │ cite-back edges
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │  AGENTIC     │    │  EXECUTION   │    │   IDEAS      │
    │  (sessions,  │    │  (board      │    │  (manual     │
    │  decisions,  │    │  tasks,      │    │  notes,      │
    │  transcripts)│    │  rollups,    │    │  hyperspace) │
    │              │    │  snapshots)  │    │              │
    └──────────────┘    └──────────────┘    └──────────────┘
            └────────── pairings / edges ─────────┘
                                 │
                                 ▼
                    ┌───────────────────────────────────┐
                    │       REFLECTIONS (owner)         │  ← higher weight
                    │   ad-hoc + systematic signals     │
                    │   MCP today, phone tomorrow       │
                    │   reshape cortex generation       │
                    └────────────┬──────────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────────────────┐
                    │   DOMINION CORTEX (the model)     │
                    │   living document per Dominion    │
                    │   summarising state, drift,       │
                    │   active threads, open questions  │
                    │   regenerated nightly             │
                    └────────────┬──────────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────────────────┐
                    │   KAIROS AGENT                    │
                    │   uses cortex as system prompt    │
                    │   prefix for any query about      │
                    │   that Dominion                   │
                    └───────────────────────────────────┘
```

**Substrate flows up, agent context flows down.**

---

## Synthesis pipeline — how the brain actually grows

```
                    DAILY INGEST (writes happen continuously)
                                  │
                ┌─────────────────┼──────────────────┬──────────────────┐
                ▼                 ▼                  ▼                  ▼
        SessionEnd hook    Board mutations    Manual capture     Reflections
        (Claude sessions)  (captureBoardEvent) (Hyperspace)       (MCP / phone)
                │                 │                  │                  │
                └─────────────────┴──────────────────┴──────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │   SUBSTRATE LAYER       │
                    │   raw memories          │
                    │   classified by stream  │
                    └────────────┬────────────┘
                                 │
                  NIGHTLY CRON (existing: snapshot + briefer)
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  ARCHETYPE GENERATOR    │  ← new
                    │  per Dominion, BYOK     │
                    │  reads substrate from   │
                    │  last 14 days + pinned  │
                    │  + ALL reflections      │
                    │  → emits 3-7 master     │
                    │  nodes per Dominion     │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  DOMINION CORTEX        │  ← new
                    │  vision_anchor +        │
                    │  current_state +        │
                    │  active_threads +       │
                    │  drift_signals +        │
                    │  open_questions +       │
                    │  recent_shifts +        │
                    │  reflection_trail       │
                    └────────────┬────────────┘
                                 │
                  MORNING + EVENING LOOPS (Phase 1D)
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  KAIROS AGENT           │
                    │  uses cortex as system  │
                    │  prompt prefix for any  │
                    │  query about Dominion   │
                    └─────────────────────────┘
```

---

## The Dominion Cortex — the meta-layer

Each Dominion gets a structured living document, regenerated nightly, that acts as Kairos's *model of how this Dominion is shaping*. Shape:

```yaml
dominion: "Aeon"
last_synthesised: 2026-06-01T03:00Z

vision_anchor:               # static — from dominion.vision/missionLong
  what_this_is: "Board/project app focused on fluid grouping…"
  ship_by: "Closed beta exit by 2026-Q3"

reflection_trail:            # owner reflections, chronological, weighted
  - 2026-05-12: "Mobile is parked. PWA via Capacitor is enough for beta."
  - 2026-05-28: "Kairos is becoming the centrepiece of Aeon, not a side feature."

current_state:               # rolled up from archetypes
  - "Kairos brain build-out is the active thread"
  - "Beta auth fixes shipped last week, no regressions"
  - "Mobile (Capacitor) parked, no movement in 14 days — aligned with reflection_trail 2026-05-12"

active_threads:              # in-progress archetypes with momentum
  - id: arch-kairos-brain
    pulse: high
    last_advance: "today — pruning + chat surface scoped"

drift_signals:               # what's stalled vs vision
  - "Tauri desktop hasn't moved in 60 days — still on roadmap?"
  - "5 raw ideas captured this week, 0 promoted"

open_questions:              # Kairos-detected gaps
  - "No archetype touches monetisation. Intentional?"
  - "Beta user count not tracked in any memory"

recent_shifts:               # what changed since last synth
  - "Aeon-driven approach to memory hygiene crystallised"
```

This cortex **IS** the system prompt prefix when you — or another agent — ask Kairos anything about Aeon. It's also stored as a memory (`type: 'dominion_cortex'`), so it's queryable, citeable, and historical (every nightly regen is its own row — you can scrub back).

---

## Reflections — the owner's signal

> *"It's important to be able to send in reflections systematically, ad hoc, and sporadically — via MCP today, via phone tomorrow. These reflections then reshape certain logics in the way this system perceives the information being fed to it through conversations."* — owner, 01/06/2026

**Reflections are the owner's direct signal to Kairos's belief layer.** They are distinct from normal memories in five ways:

| Property | Normal memory | Reflection |
|---|---|---|
| **Source** | Auto-captured or manual note | Deliberate owner statement |
| **Weight in synthesis** | Standard | Higher — explicitly weighted up in cortex generation prompt |
| **Versioned over time** | Yes (timestamped) | Yes, but presented as a **trail** showing belief evolution |
| **Can override drift** | No | Yes — a reflection saying "mobile is parked" overrides Kairos auto-flagging it as drift |
| **Channel** | Web UI, board, sessions | MCP tool (`kairos_reflect`), phone (later) — meant to be quick |

### Capture surfaces

- **Phase 1B**: `kairos_reflect` MCP tool — Bearer-auth, takes `{ dominionId, body, tags? }` → stores as `type: 'reflection'`, `streamClass: 'reflection'`, weight: `high`
- **Phase 1C**: Web UI "Send Kairos a reflection" button on every Dominion view (one click, modal, ship)
- **Phase 2**: Phone capture — quick text/voice via dedicated mobile route or SMS gateway

### How reflections reshape Kairos

The archetype + cortex generator prompt includes a block:

```
OWNER REFLECTIONS — these are the operator's stated beliefs and priorities.
Weight these HIGHER than activity-derived signals when they conflict.
Show the evolution chronologically — note when beliefs have shifted.

[most recent 10 reflections per Dominion, chronological]
```

This means:
- A reflection saying "I think we should be leaning toward gradient boosting" will reshape how Kairos interprets *future* ML memories in that Dominion
- A reflection saying "Stop flagging mobile, it's intentional" will quiet that drift signal in future cortex regens
- Belief shifts (regression → GBM → probabilistic → neural net → back to GBM) become visible to Kairos as a *trail*, not a contradiction. The agent reasons about your evolution, not just your latest state.

### Why this matters — worked example: ML / short-term power

> *Owner's framing*: "You might feel there's a vision in how you want to apply regression models, and then you lean toward gradient boosting, and then probabilistic models could be the way to go, and then you try neural networks. Each session varies what you're actually building, and you go back to accuracy, back to papers, back to knowledge bases, round and round. The knowledge — the way you're thinking about these models and how they predict in the market — keeps changing. You want this brain to be evolving with you, but you also want to be evolving with it, so you grow both ways."

**How the system handles this:**

1. Substrate accumulates: Claude sessions on regression tuning, board cards for GBM experiments, hyperspace notes on probabilistic papers, board snapshots of accuracy gates.
2. Reflections arrive periodically: *"Leaning GBM for vol regime today."* → *"Probabilistic over deterministic for tail events."* → *"Neural net experiments not paying off, back to ensemble."*
3. The cortex's `reflection_trail` for the "Short-Term Power" Dominion shows the journey — Kairos doesn't flatten it into "user is confused," it preserves it as **active hypothesis exploration**.
4. When you chat with Kairos and ask "what's our current approach to volatility forecasting?", the agent's reply is grounded in the **most recent reflection** + the **substrate that supports or contradicts it**, with cite-backs to both papers and prior sessions.
5. Drift signal: if 3 weeks pass with no reflection and substrate shows you've been silently working on neural nets again, Kairos can ask: *"Last reflection said 'back to ensemble' but I'm seeing neural net sessions — has the position shifted?"*

This is the loop. **You shape Kairos's understanding through reflections; Kairos shapes your awareness through grounded questions.** Both evolve.

### Combining reflections with task context

Reflections aren't only about thinking — they also frame what you're doing in the world. Worked second case:

> *Owner's framing*: "If you're overseeing the short-term power space as a Dominion, you should be overseeing what people are focusing on, the vision of the team, the goals, the sessions, and the engineering tools that are being built as supported."

For a Dominion that represents a team or initiative (not just a personal project), reflections combine with:
- **Team activity** (sessions, board cards, shipped features)
- **Vision anchor** (the stated mission)
- **Engineering tools** (the substrate the team is producing)

Kairos's cortex for that Dominion then carries: *team velocity, vision-alignment of current work, gaps the owner has flagged, engineering build-out status.* The agent can then say things like *"Team has shipped two pipelines this week but neither touches the volatility framework you flagged in your 15/04 reflection as the priority. Worth raising?"*

This is why reflections are first-class: **Kairos cannot have the operator's intricate understanding of business reality on its own**. The owner must keep feeding context. Reflections are that channel.

---

## Dual feedback loops + thinking chains

| Loop | When | What it does |
|---|---|---|
| **Evening (ingest)** | Nightly cron, after substrate snapshot | Reads new memories from last 24h + new reflections. Updates each Dominion cortex. Detects shifts/drift. |
| **Morning (prompt)** | Daily, before user starts work | Reads each cortex. Picks the **most urgent** thread/question (calibrated — silence is OK). Surfaces it as a Kairos chat message or advisory: *"Yesterday you reflected on X, but the board still shows Y stalled. Want to address?"* |

**Thinking chains** = Kairos chaining cortex queries before responding. Concrete example:

> *You ask Kairos: "What should I focus on this week?"*
>
> Chain:
> 1. List all Dominions
> 2. For each, read `cortex.active_threads` + `drift_signals` + `vision_anchor.ship_by` + `reflection_trail` (last 14 days)
> 3. Score urgency: `(days_to_ship_by × stall_severity × user_recent_attention × reflection_weight)`
> 4. Reply: *"Aeon Beta has 8 weeks to exit and the mobile thread is stalled 60 days. Your 12/05 reflection said mobile was parked — so the real urgency is the Kairos brain build-out, which your last 3 reflections all touched. Recommend continuing Phase 1A. Source: [aeon-cortex], [reflection-2026-05-12], [reflection-2026-05-28]"*

Chains run on cron (autonomous) AND on-demand (from chat). The autonomous version is the self-prompting capability.

---

## What "strengthening the agent" means concretely

Five capabilities Kairos gains across Phase 1 + 2:

1. **Persistent identity per Dominion** — Kairos *knows* what each Dominion is, not just what's in it. (Cortex.)
2. **Belief tracking** — Kairos preserves the owner's thought evolution, not just current state. (Reflection trail.)
3. **Drift detection** — automatically notices when execution diverges from vision *or* from stated reflections. (Cortex regen comparing substrate to reflection_trail + vision_anchor.)
4. **Question generation** — surfaces gaps as questions, not assertions ("Is mobile still in scope?" not "Mobile is dead").
5. **Cite-grounded reasoning** — every claim links back to substrate memories, so you can audit *why* Kairos thinks what it thinks. No floating opinion.

---

## Phase 1 — Foundation

**Duration estimate:** ~18-22 hours of focused implementation across 4 sub-blocks. Sub-blocks have natural ship points.

### Phase 1A — Memory shape (the de-noise)

| Order | Objective | Effort |
|---|---|---|
| A1 | Add `streamClass` field (`agentic` / `execution` / `idea` / `reflection` / `archetype` / `cortex`) to memories; backfill existing rows | 1 hr |
| A2 | Backfill `dominionId` on all memories via cascade rule (`project.dominionId → sourceMetadata.repo → null`) | 1 hr |
| A3 | Prune empty-shell board memories (filter: `source='import' AND kind='board_task_backfill' AND length(body_md) < 200`) — keep 23 rollups + ~30 rich tasks | 30 min |
| A4 | Doc `13-quality-gates.md` + weekly compaction cron | 1 hr |

**Ship point:** clean cortex, no orphan stars, hygiene wired.

### Phase 1B — Synthesis layer

| Order | Objective | Effort |
|---|---|---|
| B1 | Archetype generator: per-Dominion BYOK job that reads substrate (last 14d + pinned + reflections) → emits 3-7 archetype memories | 3 hr |
| B2 | Dominion cortex schema (`type='dominion_cortex'`) + nightly regen job — includes reflection_trail block | 2 hr |
| B3 | `kairos_reflect` MCP tool — capture reflection via Bearer auth from any Claude Code session | 1 hr |
| B4 | Reflection weighting in archetype + cortex generator prompts | 30 min |

**Ship point:** Kairos has a brain. Cortex regenerates nightly. Reflections work.

### Phase 1C — Surface

| Order | Objective | Effort |
|---|---|---|
| C1 | Chat shell — right-side Visor overlay in `KairosShell`, reuses `agent_sessions` for thread persistence | 2 hr |
| C2 | Memory-grounded responses — every reply retrieves cortex + top-k substrate, cites back via `[[memory-id]]` | 2 hr |
| C3 | MCP `chat_with_kairos` tool — Claude Code becomes a second front door to the same brain | 1 hr |
| C4 | Two-way capture — "save this turn as memory" + "promote to board card" + "send as reflection" buttons | 1 hr |
| C5 | Graph: tier filter, stream chips, archetype orbs, reflection beacons, Dominion cortex orb | 2 hr |

**Ship point:** you can talk to Kairos. From the web. From Claude Code. The graph makes sense.

### Phase 1D — Loops (lands ~7 days after C ships, after cortex has accumulated data)

| Order | Objective | Effort |
|---|---|---|
| D1 | Evening loop — cron job already exists, extend it to update cortex from new substrate + reflections | 1 hr |
| D2 | Morning loop — daily job that picks 0-1 question per Dominion (calibrated threshold), surfaces as advisory | 2 hr |
| D3 | Thinking chain runner — used by morning loop and on-demand from chat | 2 hr |

**Ship point:** Kairos starts talking back, on schedule, with calibrated restraint.

---

## Phase 2 — Active agent

After Phase 1 has run for 2-3 weeks, with the owner sending regular reflections and the cortex being trusted:

| Block | Capability | Gate |
|---|---|---|
| 2A | **Autonomous archetype refinement** — Kairos merges duplicate archetypes, splits overloaded ones, suggests new ones | Owner confirms each change |
| 2B | **Cross-Dominion synthesis** — "meta-archetypes" that span Dominions (e.g., "ML methodology spans Aeon + short-term power") | Owner confirms |
| 2C | **Active workflow triggers** — Kairos can: rerun Briefer on drift, schedule a session, promote ideas → cards, archive stale memories | Each action gated by per-type permission |
| 2D | **Calibrated proactive messaging** — Kairos messages the owner when (a) urgency × confidence crosses a threshold, AND (b) no message has been sent in last N hours | Default OFF, owner opts in per Dominion |
| 2E | **Phone capture** — voice/text reflections from mobile, optional weekly digest pushed to phone | Requires inbound channel |

---

## Phase 3 — Identity layer

> *"In the future, we can also shape your own identity or create a multiple group of identities, like a board of directors almost. But at the very least, we can create an identity that shapes and frames how you want to work with it."* — owner, 01/06/2026

| Block | Capability |
|---|---|
| 3A | **Single Kairos identity** — configurable system prompt prefix per user that shapes voice, risk tolerance, formality, focus. "Kairos as cautious analyst" vs "Kairos as ambitious strategist." |
| 3B | **Multi-agent council** — multiple Kairos identities the owner can invoke separately or in council. Each has its own framing (e.g., *the strategist*, *the engineer*, *the skeptic*, *the historian*). |
| 3C | **Council deliberation** — for important decisions, summon two or three identities, let them disagree in a structured way, owner reads the debate, picks. |
| 3D | **Identity per Dominion** — different Dominions get different default identities (the engineering-heavy one defaults to *the engineer*, the strategy one to *the strategist*). |

This is far future, but worth naming — because the data model should not foreclose it. Specifically: the cortex generator and chat agent should accept a `personaPrompt` parameter from day one, even if Phase 1 only uses a single default value.

---

## Risks & calibration

- **Morning-loop fatigue** — if Kairos pings every morning, it gets muted in a week. Threshold the urgency × confidence score carefully. Default: 0-1 message per day per Dominion, max.
- **Reflection drift confusion** — if the owner reflects too rapidly with contradicting beliefs, the cortex thrashes. Solution: cortex regen looks at reflection *trends* over windows, not just last-write-wins.
- **BYOK cost** — archetype regen + cortex regen are nightly LLM calls per active Dominion. Estimate ~$0.05-0.20/day per active Dominion on Sonnet 4.6. Sustainable for personal use, worth tracking, may need a cheaper retrieval model for the morning loop's scoring step.
- **Autonomy creep** — Phase 2C workflow triggers must be gated per action. The temptation to auto-promote ideas → cards without confirmation will be high; resist until trust is earned.
- **Cortex hallucination** — the cortex is generated text. It can be wrong. Mitigation: every cortex regen ships with cite-back to source memories; the cortex viewer must always show "synthesised from [X memories], last [N reflections]" so the owner can audit.

---

## Out of scope (named, not silently dropped)

- **Voice loop / ambient mic** — deferred indefinitely
- **Real-time collaboration on cortex** — single-owner brain for now; multi-owner Dominions would need merge logic that doesn't exist
- **External integrations beyond MCP** (Slack, Discord, email) — Phase 4+
- **Embeddings / vector search** — Phase 2+ enhancement; current FTS is sufficient for Phase 1 retrieval

---

## Open questions for execution

1. Do reflections need a UI-facing "type" or "tag" set (`belief`, `priority`, `observation`, `correction`)? Or is free-form body enough at Phase 1? **Recommendation: free-form at Phase 1, evolve based on what the owner naturally writes.**
2. Should the morning loop be opt-in per Dominion or opt-in globally? **Recommendation: global opt-in with per-Dominion override.**
3. Cortex regen frequency — nightly fixed, or adaptive (more frequent on Dominions with recent activity)? **Recommendation: nightly fixed for Phase 1; revisit after observing patterns.**
4. Where does the `chat_with_kairos` MCP tool route — does it open a real chat session that persists, or is it stateless query/response? **Recommendation: stateful — same `agent_sessions` table the web UI uses, with `source: 'mcp'` so cross-channel context works.**

---

## Sentence to start the next execution session

> *"Let's start Phase 1A — block A1, add the `streamClass` field and backfill. Plan: `docs/kairos/12-kairos-evolution-plan.md`."*
