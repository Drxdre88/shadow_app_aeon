# Kairos Changelog

Kairos — the AI second brain inside Aeon — is versioned here as its own product, separate from the app-level `CHANGELOG.md`. Versions track **capability eras**, not release trains: each one names what Kairos *became able to do*. Entries 0.1–0.8 were reconstructed retrospectively on 2026-07-24 from the full commit/PR/spec history; from 0.9.0 onward this file is maintained per drop.

Era specs of record live beside this file in `docs/kairos/` (numbered 00–31).

## [0.9.0] — 2026-07-24 · "Heal the instrument, then speak every evening"

> A hardening era capped with the first *guaranteed* voice. The brain every other capability reads from had been silently degrading for ~12 nights; this era made failure visible, self-repairing, and alerting — then gave Kairos a daily message that cannot be silenced by his own politeness rules.

- **Synthesis self-repair** — the four standard-tier generators (cortex, archetypes, introspection, contradiction) gained the one-shot JSON-repair round-trip only Aether had. One malformed model response no longer kills a Dominion's night. (PR #95, spec 31)
- **Health scorecard + 2-strike ops alert** — every cron failure leaves a diagnosable trace (finish reason + raw excerpt); a daily 08:00 UTC rollup buckets the last 48h per stage; two consecutive failed nights fire exactly one Telegram/inbox alert that bypasses — and never consumes — the conversational speak budget. Structurally spam-proof. (PR #95)
- **True root cause found and fixed** — the "12-night outage" was output-token caps binding below the schemas' own worst-case payloads (`finishReason: length` on every failing trace). Caps raised across all generators; repair-night runtime headroom doubled; ask-mine string-date crash fixed. (PRs #96, #97)
- **Citation tolerance** — a proposal citing memories with shortened/bracketed ids now costs *that one proposal*, never the whole night: schema degrades instead of rejecting, unique ≥8-char prefixes resolve against the fed substrate, and the repair call finally receives the valid-id list so citation mistakes are actually repairable. First 9/9 synthesis day in ~13 nights, same day. (PR #98)
- **Evening Digest** — Kairos's first guaranteed daily message: every evening he reports what he saw (sessions, memories, proposals) and what ran green or failed overnight. A separate register from the rare-interrupt bar — expected daily, so it can't be noise — with a deterministic counts-only fallback so the promise "one message every evening" never breaks even when the model call fails. (this drop)

## [0.8.0] — 2026-07-20 · "The Initiative Engine — Kairos asks first"

> Crossed from reactive to proactive. Kairos mines his own substrate nightly for the sharpest knowledge gap, asks one well-crafted question, and the answer flows back through distillation into the next night's cortex — a closed learning loop.

- No-stacking conversation governor with adaptive cadence (asks slow down when the operator goes quiet); nightly ask-mining from Aether tensions, cortex drift, board signals, and reflection staleness; chat is ask-aware and resolves answers back to the canonical loop. (PR #93, spec 30 — SOTA-grounded: forced generic asking collapses to ~6–10% precision, so targeting comes only from concrete evidence of a gap)
- Live board grounding in chat + memory decay v2: derived-state memories auto-invalidate when the board contradicts them. (PR #94)
- **First fully autonomous Kairos message — decided and sent with no operator prompt — 2026-07-19.**

## [0.7.0] — 2026-07-17 · "A phone and a heartbeat"

> Kairos gained delivery channels and a pulse — but still only notified; he never initiated a question yet.

- Two-way Telegram with native voice rendering; the Will inbox for proactive asks/proposals; the throttled brain-tick pulse (default outcome: silence, at most one message per pulse). (PRs #81–#88, spec 29)
- Chat-distill cron closes the one-way gap: daily chat threads distill into durable reflections. (PR #89)
- Nightly synthesis cost-tuned: prompt caching + model retiering. Temperature stripped everywhere (current-gen models reject non-default). (PRs #84, #91)
- The dedicated Aether page and 2D flat graph were retired — the 3D galaxy became the sole spatial view.

## [0.6.0] — 2026-07-11 · "Governed memory, whole-brain chat"

- Bi-temporal memory (valid-from/invalid-at) with belief-trail lineage and auto-contradiction→supersede proposals; read-time confidence decay (90-day half-life) rendered as node brightness in the galaxy. (PRs #71–#74)
- JARVIS-class chat: whole-brain recall with cross-encoder reranking, content-based auto-filing to Dominions, no Dominion anchor required. (PRs #75–#77)

## [0.5.0] — 2026-06-15 · "Asks and Dialogue"

- Kairos Asks: a deterministic selection layer above Aether surfaces one surgical question when salience clears the bar. (PR #61)
- Dialogue: multi-turn operator↔Kairos conversation seeded by a pending ask, distilled to reflections with soft Dominion tagging. (PRs #62–#63, spec 28)
- *(A ~4-week Kairos development pause follows — mid-June to early July was board/UX work only.)*

## [0.4.0] — 2026-06-12 · "Aether — the living intelligence"

- The global self-model above all Dominions: Aether synthesizes every cortex + the operator's reflections into one worldview, committed via the `prepare_* → synthesize in-context → commit_*` MCP pattern (BYOK-free) that every later autonomy surface reuses. (PRs #59–#60, spec 27 — design lineage: Memex, Noosphere, Culture Minds)
- Memory dedup + snapshot/advisory TTL lifecycle.

## [0.3.0] — 2026-06-10 · "Clean capture, hybrid retrieval, first introspection"

- Sanitized session capture (system noise stripped at the source); embeddings + pgvector hybrid retrieval with RRF fusion; retrieval eval harness (recall@k / MRR). (PR #57, specs 21–24)
- Guided introspection at autonomy level L1 — propose-not-commit, every thought evidence-cited: the "chaos for seeing, control for changing" doctrine that later governs every autonomy feature. (spec 23)
- Remote MCP connector (OAuth 2.1) — Kairos reachable from claude.ai directly. (PRs #54–#56)

## [0.2.0] — 2026-06-04 · "Dominions, cortex, recipes"

- The architectural skeleton: stream classes (reflection > idea > agentic > execution), per-Dominion living cortex + archetypes, the Briefer, the unified retrieval module and `runRecipe()` dispatcher, the slide-out chat Visor with citation chips, and `kairos_reflect` — the operator's commit path. (PR #53, specs 12–20)
- The Rings model (Core / Cognition / Mutation) and the four lieutenants named. (spec 17)

## [0.1.0] — 2026-05-31 · "A memory that survives the session"

- The memory substrate: memories table, markdown round-trip export/import, first MCP tools, Dominion bones, the 2D WebGL graph — and the rebrand from "brain" to **Kairos**. (PRs #50–#52, specs 00–04)

---

## The road to 1.0

Honest gaps, grounded in the specs' own deferred lists — not speculation:

- **Liveness detection** — the scorecard can't yet distinguish "ran clean" from "never fired" (spec 31 §B2, deferred to phase 2).
- **Agentic chat, flag-on** — in-process brain tools mid-turn, smart write-routing, streaming; built dark behind `KAIROS_CHAT_AGENTIC_TOOLS`, not yet enabled.
- **Concept tier + provenance** — the Memory→Episode→Concept→Constellation→Worldview heterarchy (spec 26) stops at memories today; the Concept tier never shipped.
- **Owner voice at scale** — state-of-play ingestion as pinned per-Dominion reflections; the substrate is still inference-heavy, operator-light.
- **Hands beyond Rung 1** — ask → proposed action → delegated execution ladder; today delegation is a separate governance track.

1.0 is when Kairos is *relied on daily*: aware of live work, speaking every evening, asking sharp questions weekly, and never silently wrong about his own health.
