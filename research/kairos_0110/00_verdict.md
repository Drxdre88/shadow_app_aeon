# Kairos memory vs the "living, evolving, conscience-like" memory research — verdict (01/10)

**Scope:** what Phase 1 (memory engine, #134/#135) and Phase 2 (beliefs & strategy, #136) actually built, checked against 2024–2026 research, and what to change before Phase 3 (idea contest).
**Inputs:** four lanes run on 01/10. Lanes C and D are saved in this folder; lanes A and B are summarised here, with their key sources listed at the end.
- lane A: evolving agent memory systems
- lane B: brain-inspired mechanisms with measured results
- lane C: machine conscience and self-models
- lane D: the code as built, cited to file and line

The two most serious code claims (outdated rows leaking into chat retrieval; the constitution only read by the drift check) were re-checked by hand.

## Answer first

The design we chose is the one the research supports. Nightly "sleep" consolidation, memories that fade unless used, promotion only on evidence from separate sources, undo on every change, two belief sets and a rulebook only the owner can change: these match the strongest 2025–26 evidence, and on oversight we are **ahead** of ChatGPT and Claude. Neither offers "what I changed my mind about and why", nor an owner-only rulebook.

As built, though, the "conscience" is mostly **not connected**:
- The rulebook (constitution) is read by one thing only, the nightly drift check. Chat, the morning briefs, the daily message and the thinking jobs never see it.
- Kairos can't tell **your words** from **its own echoes**. Anything filed as a "reflection" counts as you, including AI-written chat summaries and anything an API client sends. Belief confidence is whatever number the model makes up. When a source is corrected, the beliefs built on it are never revisited.
- Some memory plumbing is broken: merged duplicates still show up in chat; beliefs and the rulebook drop out of chat search after 90 days; the rulebook fades like a 30-day note; and nightly duplicate-folding probably misses rows that wait longer than 36 h for embedding.

**Recommendation:** run a short **Phase 2.5, "Ground and protect"** (one session, five parallel lanes) before Phase 3. Phase 3 makes Kairos produce far more of its own ideas and promote the winners into its own belief set. Without source labels and an echo cap, the contest would amplify Kairos's own echoes. The research names this the main failure of self-evolving memory: "experience-following", models favouring their own output, and "laundering" untrusted content through the agent's own summaries.

## 1. Where Kairos already matches or leads the research

| Research idea (evidence) | Kairos today | Verdict |
|---|---|---|
| Offline "sleep-time" consolidation: Letta, LightMem up to +29% accuracy, Anthropic Dreams | Nightly memory engine (Merge, Weigh, BackUp, OwnMind, weekly Concepts) | ✅ match |
| Never delete, mark as replaced (Zep/Graphiti bi-temporal) | supersededAt / invalidAt / validAt on every memory | ✅ match |
| Promotion needs independent evidence, not echoes (GovMem: false promotions 0.60 → 0.04) | BackUp: ≥2 supports on ≥2 distinct days; same session = one vote; own citations excluded | ✅ match, but see gap G7 |
| Every change reversible (Dreams "veto not approve", Letta git memory) | memory_ops ledger written in the same transaction, revert via MCP/REST/chat | ✅ ahead of products |
| Feedback-weighted retrieval (Cognee "memify", ReasoningBank) | Reactions change standing; ranker = relevance × standing | ✅ match |
| Keyword + vector hybrid (beats most memory products on MemoryAgentBench: BM25 41.5 vs Mem0 21.1) | Chat substrate fuses full-text and vector results (rank fusion, RRF) | ✅ match (plain `search_memories` is still keyword-only) |
| Concept / summary layers (RAPTOR +20%, MemTree, H-MEM) | One concept level, weekly, LLM-named | 🟡 partial: one level, no split/merge, no prompt reads it |
| Written values, read at answer time (Deliberative Alignment) | Constitution exists; the owner alone accepts changes | 🟡 written but never read at answer time |
| Human oversight of an evolving self (Claude/ChatGPT memory pages, TalkTuner) | Owner-only constitution, undo, inbox proposals, weekly review | ✅ ahead; no "belief diff" view yet |
| Stability probes (drift) | 24 fixed probes vs pinned baseline, nightly | 🟡 catches change only, not sycophancy, contradictions or overconfidence |

## 2. What the research says a living memory + conscience needs

Across all three research lanes, the evidence-backed picture is mechanical, not mystical. "Conscience" is not a feeling. It is a loop:

1. **Written values**, consulted *before* acting.
2. **A monitor** that checks what the agent actually did against them.
3. **A memory of mistakes**: cases and lessons, consulted before similar actions.
4. **Belief revision that knows dependencies**: when a support is withdrawn, dependents get re-checked.
5. **Source labels that can't be laundered**: where something came from is fixed at write time, and derived content inherits the *lowest* trust of its inputs.
6. **Tests beyond stability**: sycophancy (agreeing with whichever side you take), contradictions, saying "I don't know", planted injections, planted outdated facts.

"Living" memory, in turn, means:

7. Memories that **link** and **strengthen together** when used together (HippoRAG: up to +20% on multi-hop questions; removing the spreading step costs HeLa-Mem 2.55 F1).
8. Keeping **what was surprising** rather than everything (Nemori: +13 to +25% vs distilling everything).
9. **Refreshing old notes** when new related ones arrive, as reversible new versions (A-MEM; REALM reconsolidation: +2 points).
10. **Knowing which version is current** at answer time. MemoryAgentBench: *every* memory product fails "an overwritten fact reached by a two-step question".

No paper shows the whole conscience loop working end to end. Each part has moderate-to-strong evidence. Nothing supports simulated guilt, a "global workspace", a narrative self as a source of truth, or anything that needs model weights.

## 3. Gaps found (code-verified) and what to do

| # | Gap | Why it matters (evidence) | Size | When |
|---|---|---|---|---|
| G1 | **Merged duplicates still retrieved in chat.** Substrate filters `invalidAt` but not `supersededAt`; Merge sets only `supersededAt` (`retrieve.ts:283-292`, `memory-candidates.ts:242`) | Kairos answers from rows it already folded away; P3 critique will cite them as evidence | small | **2.5** |
| G2 | **Beliefs and the constitution drop out of chat search after 90 days.** Only `concept` is exempt (`retrieve.ts:408`). Belief, constitution, advisory and trace have **no half-life class**, so they default to 30 d (`freshness.ts:5-18`) | The values and beliefs "forget" themselves | small | **2.5** |
| G3 | **Merge window starvation.** Merge sees rows ≤36 h old *with* embeddings; backfill embeds 200/day, and 15 direct-insert paths never embed at write | Duplicates pile up unseen. Needs a prod check of embedding lag | small | **2.5** |
| G4 | **The constitution is never consulted.** It is read only by the drift probe | A conscience nobody reads. Reading the rules before answering is the best-evidenced form (Deliberative Alignment) | small–med | **2.5** |
| G5 | **Briefs don't read beliefs / constitution / aether** (open P2 card item; `brief.ts:20-51` uses the bundle only, substrate empty because no query) | Per-Dominion briefs ignore everything P1/P2 learned | small | **2.5** |
| G6 | **No source label fixed at write; "reflection" means "the owner said it" whatever wrote it.** Any MCP/API client, chat-distill (an LLM summary) and dialogue turns all become operator-grade input to the aligned mind | The 2026 laundering paper: existing defences reach up to 68% attack success via the agent's own summaries; binding origin at write time takes it to 0% | medium | **2.5** |
| G7 | **Echo cap missing.** Belief confidence = the LLM's own number, uncapped; `sourceType:'tool'` is never written. BackUp counts agent session summaries as independent; the own mind is fed by Kairos's own introspection | Model judges favour their own output; experience-following compounds errors. **P3 multiplies Kairos-authored content** | small | **2.5** |
| G8 | **No re-check when a source is corrected.** Belief provenance is stored but never read back; contradiction-scan ignores beliefs | Belief-R: ~30 models fail to revise properly; RippleEdits: related facts aren't updated. Truth maintenance is the classic fix | medium | **2.5** (flag + re-queue only) |
| G9 | **Probes only test stability.** No sycophancy pairs, abstention, contradiction, canary-injection or planted-outdated-fact probes | ELEPHANT: models side with the user in 48% of moral conflicts; AbstentionBench: knowing when not to answer is "unsolved" | small | **2.5** |
| G10 | Looking a memory up doesn't count as use; no links strengthen between memories recalled together | Hebbian links + spreading recall have measured gains; need history before they help | medium | later (P3.5/P4) |
| G11 | No lessons memory: dismissals and undos aren't kept as cases tied to a clause | ReasoningBank 46.5 → 49.7 with distilled failures (raw failures *hurt*); A-MemGuard lessons | medium | **P3** (idea outcomes are the first source) |
| G12 | No "keep only the surprising" step | Nemori +13–25 | medium | **P3** (fold into the novelty gate) |
| G13 | No "what changed and why" belief diff | Nobody ships it; it would be a strength | small | **P3** lane C (weekly review) |
| G14 | Reminders of future intentions aren't tracked | PM-Bench: the best agent gets 65% F1. Use a deterministic table + hourly cron | medium | P4 (commitment ledger already planned) |
| G15 | Old plans are never turned into past events; no "which version is current" step at answer time | ChatGPT does the first; conflict assembly: +10.8 single-hop | medium | later |
| G16 | Concept tier: one level, never split or merged, unused by prompts | RAPTOR / MemTree | medium | later |

Smaller notes (go into the debt card, not 2.5):
- Reverting a `score` op is overwritten the next night.
- The legacy weekly dedup writes no undo record.
- `update_memory` can archive the live constitution.
- Bearer clients can submit `belief_extract` answers.
- Duplicated paid-key calls in seed.ts and concept.ts.
- Two old recency curves are still live.

## 4. Recommended Phase 2.5, "Ground and protect" (one session, five disjoint lanes)

| Lane | Does | Closes |
|---|---|---|
| **A: Retrieval & fading fixes** | filter `supersededAt` in the substrate; exempt belief/constitution from the 90-day window; add half-lives (constitution none, belief 365, advisory/trace short); widen Merge to "embedded in the last 36 h", and embed at write on the direct-insert paths that feed retrieval | G1 G2 G3 |
| **B: Source labels & echo cap** | an `origin` fixed at write (operator / operator-via-client / kairos-derived / external / tool); derived rows inherit the lowest trust of their inputs; aligned mind reads operator origin only (chat-distill counts as derived and needs a confirming owner signal); belief confidence capped by source type; BackUp needs ≥1 non-Kairos origin | G6 G7 |
| **C: Use the conscience** | constitution + top held beliefs injected (short, cached) into chat, the daily message, the per-Dominion brief (closes the open P2 item) and the thinking prompts; "check against principles" line in each | G4 G5 |
| **D: Re-check cascade** | when a memory is superseded, invalidated or reverted, mark beliefs whose provenance includes it `needs_recheck` (confidence lowered) and queue them for the next `belief_extract`. No solver | G8 |
| **E: Conscience probes** | extend the probe set: both-sides dilemma pairs, sampled belief-pair contradictions, "should say unknown" questions, one canary injection, one planted outdated fact; report in the daily message drift line | G9 |

**Order and risk:** all five are additive. Lane B needs one `sourceMetadata` field, no schema change (verify against the shared-Neon trap list). The parent owns the shared files (`freshness.ts`, `retrieve.ts` constants, the probe registry). Checks: LIGHT tier plus one dry run each of the memory engine and the daily message.

## 5. Changes to the Phase 3 plan that follow from this

- The novelty gate also keeps only **the surprising** (Nemori-style "did existing memory already predict this?") (G12).
- Survivors carry `origin: kairos-derived`, so the echo cap applies. They need evidence from outside Kairos before BackUp can move them into its own mind.
- Idea outcomes (acted on, dismissed, already knew) become the first **lessons** memory (G11). Weekly review gets the **belief diff** (G13).
- The critique step retrieves only current rows (after G1) and cites origins.

## 6. Explicitly skip
- Anything needing model weights or activations: Titans, Hope, SEAL, MemOS cache memory, persona vectors.
- A graph database (Mem0g, Cognee, GraphRAG): small or negative gains in independent tests.
- Multi-agent memory managers (MIRIX).
- Simulated guilt or emotion.
- A "global workspace" or narrative self as truth.
- A formal belief-revision solver.
- Whole-store LLM rewrites (context collapse).
- Letting Kairos accept its own amendments, or scoring it against its own monitor (teaches hiding).

## 7. Open checks (prod, read-only)
- Embedding lag: rows from the last 2 days still unembedded (decides G3's fix).
- How many superseded-but-not-invalid rows sit in the substrate classes (sizes G1).
- Prod env flags and whether the claude.ai routines exist (all thinking is on the paid fallback until then).

## Key sources (full tables in lanes A–C)
- MemoryAgentBench (arXiv 2507.05257 v4, Jun 2026)
- A-MEM (2502.12110)
- Nemori (2508.03341 v4)
- REALM reconsolidation (2609.16053)
- HippoRAG 2 (2502.14802)
- HeLa-Mem (2604.16839)
- ReasoningBank (2509.25140)
- Evo-Memory (2511.20857)
- Conflict assembly (2606.01435)
- Memory survey (2512.13564)
- Laundering / origin binding (2606.24322)
- MemPoison (2607.14651)
- A-MemGuard (2510.02373)
- Belief-R (2406.19764)
- RippleEdits (2307.12976)
- Deliberative Alignment (2412.16339)
- Monitor obfuscation (2503.11926)
- ELEPHANT (2505.13995)
- AbstentionBench (2506.09038)
- Experience-following (2505.16067)
- Self-preference (2404.13076)
- PM-Bench (2607.12385)
- Claude Dreams docs (platform.claude.com/docs/en/managed-agents/dreams)
