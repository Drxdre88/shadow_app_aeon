# Kairos 2909 — The five modules vs the original blueprint, grounded in SOTA (crawls verified 2026-09-29)

## A. Original blueprint ("Ultron") — docs/kairos/12, 16, 17, 26, 27, 30

Three rings: **Ring 0 Core** (substrate, cortex, archetypes, traces) · **Ring 1 Cognition** (recipes BRIEF/REFLECT/DECIDE/RECONCILE/PREDICT run by lieutenants Acolyte/Sentinel/Cartographer/Oracle; decision graph as crystals in the galaxy; Concept tier + Hebbian weighting; thinking chains = cron urgency scoring; Phase 3 identity layer + council of personas) · **Ring 2 Mutation** (Phase 8 initiative engine `streamClass:'initiative'` with investigative/mutative/external risk tiers + boundary-based approval; Phase 9 deep-think jobs; Phase 10 `dark_lab_kairos/` repo; Phase 11 self-authored recipes; Phase 12 forked self).

| Module (owner naming) | Blueprint location | Built? |
|---|---|---|
| Memory evolution | spec 26 Concept tier, Constellations, Hebbian weighting, consolidation daemon; 12-2A autonomous archetype refinement | ❌ primitives only (embeddings, supersession, dedup). No Concept tier. Archetypes regenerate, never refine |
| Philosophical | spec 27 Aether self-model; 12-3A persona prompt; belief tracking + cite-grounded reasoning | 🟡 Aether = nightly summary. No identity/persona, no values store, no self-questioning |
| Creativity | 12-3B/3C council of personas; 16-P5 decision graph; introspection eureka kind | ❌ council + decision graph never built; eurekas = pending proposals nobody reads |
| Motivational | 17-P8 initiative engine; spec 30 became "asks first" only | ❌ no `initiative` stream class; Ring 2 has zero code; `dark_lab_kairos` never created |
| Strategic | 12 thinking chains + morning loop; PREDICT/DECIDE recipes; Oracle | 🟡 briefer exists but reads only the raw bundle; no chains, no PREDICT/DECIDE; Oracle folded into tick |

Of 5 recipes, 1 exists. Of 4 lieutenants, 1 file (Sentinel), unscheduled. The July VISION rewrite ("gaps vs Ultron are features we will never close on purpose") silently reversed the June plan → the "old Kairos meshed with new Kairos" feeling.

## B. What the evidence says (three crawler lanes; tier-1 sources, dates in the lane reports)

### Memory evolution
- Field consensus: **cheap write gate** (Mem0: top-10 similar → LLM picks ADD/UPDATE/DELETE/NOOP), **invalidate never delete** (Zep/Graphiti bi-temporal), **offline sleep consolidation** (Letta sleep-time; Anthropic Dreams writes a NEW store, input untouched, auto-apply or review = "veto not approve"), **cited reflections** (Generative Agents: ablation 29.89 → 26.88 without reflection).
- Governance is the 2026 frontier: GovMem (Jun 2026) routes candidates promote/reject/needs-review and **echoed or shared-lineage evidence must not count as independent votes** (false promotion 0.597 → 0.040); CPB (Sep 2026): an uncontested false belief is asserted in 97-99% of probes; paraphrase evades dedup.
- Reflection helps only when grounded; self-correction without external feedback can degrade (ICLR 2024); whole-summary rewriting causes context collapse (ACE) → itemised deltas with helpful/harmful counters (ACE/ExpeL).
- Trust from source channel, never from confident phrasing (2606.22030). Bayesian belief math degenerates to last-write-wins without real per-source reliability.
- Benchmarks unreliable (LoCoMo 6.4% wrong gold; vendor numbers conflict by 10+ pts) → use in-house behavioural probes (stability, plasticity, contradiction, stale, split-session).
- No controlled eval exists for "re-read pending hypotheses nightly, promote those that persist" — closest: dual-buffer probation (proposal), GovMem, BeliefMem, Hindsight.
- Skip: RL-trained managers (Memory-R1, AtomMem), separate graph DB, Noisy-OR/Bayesian math, unconstrained self-critique.

### Creativity
- Best-evidenced: Google Co-Scientist loop (generate → critique → pairwise Elo tournament → evolve), Nature May 2026, lab-validated; batch job → fits a nightly cron.
- LLM ideas rate MORE novel than experts' pre-execution (ICLR 2025) but the ranking FLIPS after 100+ h execution (ICLR 2026); LLM novelty judges show a "novelty mirage" → anchor scores to operator uptake + outcomes, never LLM self-rating.
- Diversity decays within weeks across ~30k agents (Sep 2026). Fixes with evidence: one planning call stratifying ideas across semantic directions; ordinary (not famous) personas + CoT; pgvector novelty gate vs own archive then LLM judge (ShinkaEvolve).
- Multi-agent debate: majority voting explains most gains (NeurIPS 2025); generative debates drift 76-89% (EACL 2026) → keep pairwise judging short.
- Skip: AI-Scientist-style autonomy (42% experiment failures, broken novelty check), long debates, famous personas, conceptual-blending frameworks (no 2025-26 human-validated evidence).

### Philosophical / metacognitive
- Strongest drift evidence is about MEMORY WRITES: saved user claims → 71.9% downstream failure vs 45.0%; user-profile memories raise agreement sycophancy +16-45%; explicit memory editing (→32.7%) and domain-grouped memory (−8.8% leakage) reduce it.
- Introspective self-reports ≈20% reliable (Anthropic Oct 2025); agents with 22% success predicted 77%; adversarial "find the bug" framing gives best calibration; persona drift worst in philosophical "own nature" conversations (Anthropic Jan 2026) — activation fixes unavailable on API models → fixed nightly probe set.
- Claude's constitution: reasons over rules (Jan 2026, CC0).
- Skip: introspection as truth, activation-level methods, "intrinsic metacognitive learning" (position paper only).

### Motivational
- Evidence-backed pattern: **archive-driven goal proposer** (Voyager, OMNI-EPIC, MAGELLAN): LLM proposes next "interesting and learnable" goal from a record of past attempts; separate step scores novelty + learning progress; works ONLY with verifiable outcomes. Free-form self-goaling: models exploit one solution, repeat tasks (2603.03295, 2510.14548).
- Persistence comes from harness structure (progress file, one increment per session, no self-declared done — Anthropic Nov 2025), not from "drives".
- CivBench (Sep 2026): agents under-monitor (checked every 30-75 turns when told 20) and execute only 48-66% of their own stated commitments → cron-enforced monitoring + commitment ledger.
- Skip: RL intrinsic motivation training, DGM-style self-modification without benchmark + human gate.

### Strategic
- No evidence MCTS/ToT strategic planning beats periodic structured review for portfolio oversight; tree search proven only with verifiable reward (math/code/games/web). Chain-in-Tree cuts ToT cost 75-85% with negligible loss → uniform tree search wastes compute.
- "CEO agent" hierarchies unproven (Project Vend 2: profit "may have been in spite of the CEO"; MAST: ~79% of multi-agent failures = specification/coordination; multi-agent research ≈15× tokens).
- Chief-of-staff products (Pulse, Asana Dash) publish no effectiveness data.
- Governance consensus (Anthropic, OpenAI, Singapore 2026, DeepMind): autonomy level per action class (L1 operator … L5 observer), bound tools/data up front, human checkpoints at high stakes, prefer monitoring+intervention over per-action approval, hard budget caps + kill switch. Agentic-misalignment: goal conflict or replacement threat → harmful insider behaviour across vendors → **never give Kairos a self-continuity goal**.

## C. Module designs (how each lands on existing organs)

| Module | Design | Lands on | New |
|---|---|---|---|
| Memory evolution | write gate over top-10; candidate tier promoted only on ≥N independent supports across ≥M distinct days, lineage-aware counting (own outputs/same session/same tool dump = ONE vote), decays otherwise; consolidation as generation swap with diff guards (count drops, protected-core contradictions, provenance loss) + one-click revert; cited reflections w/ helpful/harmful counters; provenance-capped confidence; itemised deltas | bi-temporal columns, supersession, pgvector; today's 3,881 proposals = candidate tier; micro-consolidate/cortex → itemised; `resolves` gets a writer | promotion job, append-only op ledger, Concept tier (spec 26) |
| Philosophical | belief ledger (values, first principles, worldview claims: source_type operator>tool>inference, provenance ids, confidence, domain, supersedes, status); reasons-based versioned constitution amended only via proposal; falsification check ("what evidence would falsify this?") against retrieved records; nightly drift probe set (20-40 Qs vs pinned baseline); chat never writes beliefs directly; beliefs presented grouped by domain | Aether = worldview tier of the ledger (not a daily rewrite); reflections = top source type; Dominion vision/mission seed the constitution | belief type, constitution doc, probe set |
| Creativity | nightly tournament: stratified generate 8-16/focus area, ordinary personas, critique vs retrieved memory + web, pairwise Elo with judge ≠ generator, mutate top 2-3, keep 1-3; novelty gate (max cosine vs own archive → LLM "meaningfully different?"); weekly diversity metric as collapse alarm; outcome grounding (acted-on / dismissed / already-knew) feeds Elo priors | replaces raw introspection dump; contradiction-scan = critic input; inbox gets survivors only | idea archive fields (elo, embedding, parent_id, status, outcome), tournament job |
| Motivational | goal archive (proposed/attempted/succeeded/failed/abandoned + verifier + outcome); proposer ≤N/night; novelty gate; learning-progress ranking; verifier-first (card state / test / metric / PR); commitment ledger ("I will X by T") checked by CRON with escalation; harness discipline (one increment per run, progress note on card, no self-close) | = spec 17 Phase 8 initiative engine; Hangar missions = verifier + hands; AI Mission Control cards = surface; Telegram approve/veto (callback wired, button never sent) | `initiative` stream, commitment ledger, proposer job |
| Strategic | weekly structured review over fixed inputs (board deltas, commitment ledger, goal-archive stats, belief ledger) → proposals not actions; spec 12 thinking chains as deterministic urgency pre-pass; one daily message (digest+brief merged) | briefer rewired to read cortex/aether/ledgers; Sentinel scheduled weekly as cross-Dominion tension organ; Oracle role = tick | weekly review job |
| Governance (all) | autonomy level per action class; veto-not-approve for memory; approve-before-act for cards in others' projects; graduate a class to observer only after clean track record; maxBudgetUsd/maxTurns per run; nightly initiative quota; allowlisted tools; kill switch; periodic time-out re-authorising standing initiatives; no self-continuity goals | | |

## D. Phase order (proposed, awaiting owner go)
P0 Eyes & Heal (2 sessions) → P1 Memory evolution (2) → P2 Philosophical + Strategic rewire (2) → P3 Creativity tournament (1-2) → P4 Motivational / initiative engine (2) → P5 Ring 2 proper (dark lab, deep-think, self-authored recipes; gated on P4 track record).
