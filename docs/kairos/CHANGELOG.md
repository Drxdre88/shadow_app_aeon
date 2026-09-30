# Kairos Changelog

Kairos — the AI second brain inside Aeon — is versioned here as its own product, separate from the app-level `CHANGELOG.md`. Versions track **capability eras**, not release trains: each one names what Kairos *became able to do*. Entries 0.1–0.8 were reconstructed retrospectively on 2026-07-24 from the full commit/PR/spec history; from 0.9.0 onward this file is maintained per drop.

Era specs of record live beside this file in `docs/kairos/` (numbered 00–31).

## [0.12.0] — 2026-09-30 · "The Memory Engine"

> Memories stop being a pile. Every night Kairos weighs, ages, backs up, merges and groups what he knows, learns from how you react, and keeps a full undo trail. His thinking can now be done by Claude on your Max plan, with the paid key as a safety net. Spec: `docs/kairos/32-memory-engine.md`, routine playbook `33-thinking-routine.md`.

- **Standing** — every memory gets a nightly trust-and-value score from composable parts: who said it, how fresh it is (per-class fading), how often it's used, independent backing, outcome of your reactions, open challenges. Search and chat rank by relevance × standing; unscored memories rank exactly as before.
- **"Maybe" beliefs earn their place** — Kairos's own proposals become beliefs only when separate evidence on two different days backs them; unsupported ones fade after three weeks. The evening message lists new beliefs with a veto hint.
- **Repeats fold together** — near-identical new memories merge into the older copy, reinforcing it.
- **Undo everything** — every engine change is logged with its reason; `list_memory_ops` / `revert_memory_op` (MCP + REST) undo any change, and a vetoed change is not redone.
- **Your reactions teach him** — accepting, dismissing, answering an ask and chat citations feed back into standing.
- **Concepts** — weekly, closely related memories in each Dominion are distilled into one cited concept (spec 26); clusters dominated by your reflections become proposals instead.
- **Thinking queue** — cortex, Aether and concepts can be claimed and answered by a scheduled Claude Max routine through the Aeon connector (`claim_thinking_job` / `submit_thinking_job`); the server validates and persists, and the existing paid-key crons still run if the routine doesn't.

## [0.11.0] — 2026-09-30 · "Eyes & Heal"

> The 29/09 reassessment found the mesh generates but never metabolises: nothing Kairos produced came back round, questions had been silently blocked since July, and the operator's own board reached him as bare titles. This era fixes the four live defects and gives him eyes on what actually happened. Plan + evidence: `aeon_os/HANDOVER_2909.md`, `research/kairos_2909/`.

- **He can ask again** — only a real question now waits for a reply; routine notes, alerts and digests no longer block asks for 48h. Answering or dismissing in the web inbox counts as a reply.
- **No more runaway messages** — digest output that didn't finish cleanly, runs long, or looks like pasted web content falls back to the plain summary; cut-off chat replies end cleanly. Digest covers a rolling 24h.
- **Night thinking stops breaking** — the model never mints stored IDs any more (Aether, cortex, contradiction, archetypes, introspection); the server mints and validates against what it fed; one shared repair path. Cortex and Aether read the day actually being consolidated.
- **Honest health** — every cron writes a daily ok/skipped row, so "ran clean" is distinguishable from "never ran"; the brief is one stage, not three.
- **Eyes on the work** — sessions from all three coding tools carry one session record (card, branch, commits, PRs, tests, model, tokens, cost); mission worktrees file under the real repo; finished Hangar missions become one memory linked to the card; memories get a class and trust by source at one choke point.
- **The sprint board is the main feed** — boards opted in via `settings.kairosFeed` get one "board day" page (finished cards with notes and checklists, started, created, title-only), or a weekly milestone page; completed-card memories carry notes; title-only cards trigger a one-line-each nudge whose answer is written back onto the cards (live and vaulted).
- **Recency that holds** — rerank no longer ignores age; a true 14-day half-life shared by both ranking paths; intraday deltas carry over past midnight (new 23:15 UTC pulse); per-Dominion board counts.
- **Galaxy stops crashing** — loads the ~1,500 most important memories and renders them in a fixed handful of GPU objects.
- **Dead weight removed** — compaction cron stub, initiative/eval metrics, unused recipe registry, dead retrieval helpers.

## [0.10.0] — 2026-07-24 · "The Live Mind"

> Same-day follow-through on the operator's verdict: "his brain isn't continuously updating — he's not really with it." The JARVIS gap was his eyes, not his mind. This era gives Kairos continuous awareness — and moves his entire cognition to the top model tier under the standing quality-over-cost directive.

- **Always-current chat** — every turn carries a deterministic "last 24 hours" block (sessions, thoughts, proposals, board deltas), and memory search finally weights recency (the same-day-reflection blindness is root-caused and regression-locked). Web + Telegram alike.
- **Live tools on by default** — mid-conversation, Kairos can search his brain (hybrid + recency), read live boards, list recent activity per repo, and **check his own synthesis health** — self-certification instead of narrating stale incident memories.
- **Intraday self-model** — a micro-consolidation pass 6×/day folds new activity into a per-Dominion "today so far" delta that the nightly cortex/Aether synthesis reads; understanding shifts within hours, not days.
- **Incident lifecycle** — the new `resolves` relationship closes an incident's memories the moment a correction lands (create-time or linked after the fact); closed memories exit synthesis, briefings, and chat in one cycle. The post-heal hysteresis — a fixed outage narrated as current for days — is structurally dead.
- **Quality over cost, permanent** — every cognition path runs the heaviest model tier; the 07-15 cost downgrades are reversed by standing directive.
- Review gauntlet: 5-agent horsemen + cross-model pass; all findings (atomic resolution stamping, UUID validation, recency clamp, Telegram redelivery guards, truncation visibility) fixed and re-verified.

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
- **Chat streaming + smart write-routing** — agentic tools shipped ON in 0.10.0; the remaining chat gaps are token streaming and auto-filing durable turns to Dominions ("filed under X" transparency).
- **Concept tier + provenance** — the Memory→Episode→Concept→Constellation→Worldview heterarchy (spec 26) stops at memories today; the Concept tier never shipped.
- **Owner voice at scale** — state-of-play ingestion as pinned per-Dominion reflections; the substrate is still inference-heavy, operator-light.
- **Hands beyond Rung 1** — ask → proposed action → delegated execution ladder; today delegation is a separate governance track.

1.0 is when Kairos is *relied on daily*: aware of live work, speaking every evening, asking sharp questions weekly, and never silently wrong about his own health.
