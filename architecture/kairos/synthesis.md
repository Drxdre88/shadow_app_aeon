# Kairos — Synthesis Pipeline

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [chat](chat.md)

Synthesis turns flat accumulation into a layered, self-consolidating brain. Each stage reads the
substrate (and the stage below) and distils one tier up, writing back into `memories` with a
dedicated `streamClass`. All stages are per-user, idempotent per UTC day, soft-archive their
priors transactionally (never leaving a tier empty on a failed insert), and skip gracefully on
missing/undecryptable BYOK keys. State as of **Kairos 0.15.0 "Creativity"** / app **v0.32.0**
(`lib/kairos/version.ts:3`, `lib/version.ts:6`).

**Parse reliability (docs/kairos/31).** The standard-tier generators (archetypes, cortex,
introspection, contradiction) wrap `extractJsonBlock → zod.parse()` in `parseWithRepair`
(`_prompt-utils.ts`): one same-provider repair round-trip with the raw text + validation error,
then `ParseRepairError`. Failure traces carry `finishReason`, a 500-char `rawExcerpt`, and split
`parse_failed:syntax` vs `:schema`. Thinking-queue kinds parse strictly on a routine submit (no
repair); their paid fallback (`askPaidAndParse`) gets one repair turn.

## Stages

### Chat distillation (02:00 UTC)
`lib/kairos/chat-distill.ts` → `runChatDistillForUser()`. Every kairos-chat thread with turns on
the prior UTC day (Telegram included, ≤80 msgs/thread) is distilled into **operator-voice
reflections** (≤5/thread/day; externalId `chat-distill:{date}:{threadId}:{n}`; per-thread failure
isolation). Archetypes read them the same night. 240s deadline guard under the 300s budget.

### Archetypes (02:30 UTC, per Dominion)
`lib/kairos/archetypes.ts` → `runArchetypeSynthesisForDominion()`, fanned out by
`runArchetypeSynthesisForUser()`. Reads 14 days of non-pinned substrate (≤80), pinned (≤30),
reflections (≤30, weighted), live archetypes (≤10), and the Dominion's vision, mission, objectives
and cards. Emits **3–7 master nodes** (`streamClass='archetype'`). Idempotency: `alreadyRanToday`
(live archetype created today, `isNull(archivedAt)`).

### Cortex (03:00 UTC fallback, per Dominion — the living document)
`lib/kairos/cortex.ts` → `runCortexRegenForDominion()`. Reads Dominion strategy, live cards,
reflections (≤30), today's archetypes (≤12), the prior cortex and the latest intraday delta. Emits
one `dominion_cortex` memory (`streamClass='cortex'`; markdown + `sourceMetadata.cortex`).
**Race defense:** a Dominion with activity but no archetypes today defers. Normally served by the
`cortex` thinking job; the cron covers anything unanswered by 02:58Z.

### Aether (03:15 UTC fallback, global self-model)
`lib/kairos/aether.ts` → `runAetherForUser()`. One cross-Dominion self-model per UTC day from
the latest cortex per Dominion, top-40 reflections, today's archetypes and the prior Aether. Payload
`{ thoughts[], tensions[], shifts[], coreNarrative }`. **Anti-drift leash:** thoughts with zero
`sourceMemoryIds` are stripped; none left → nothing written. Its **tensions feed the idea
tournament** and its digest feeds BRIEF. Doc: `docs/kairos/27-aether-the-living-intelligence.md`.

### Idea tournament (nightly, after Aether — Kairos 0.15, docs/kairos/35)
Two thinking kinds that replace the raw introspection dump with **1–3 ideas a night that survived
critique**. Contract and constants: `lib/kairos/ideas/types.ts`.

1. **`idea_generate`** (`thinking/handlers/idea-generate.ts`). `planIdeaGenerate` (`:132`): once
   per UTC day (`idea_generate:<day>`), ≥1 active Dominion, once today's Aether exists **or** from
   03:30Z (`:59`), and only with input signal. It has a 55-minute deadline (`:58`). Inputs come from
   `lib/data/idea-inputs.ts`: open objectives, the Aether digest, `board_day` pages (3 days, ≤9),
   held beliefs from both minds (≤20), concepts (≤10), and the operator's reflections (7 days, ≤15).
   Soft priors that are not citable: the last 30 days of idea outcomes and per-direction stats
   (`gatherIdeaInputs` `:107`). The model picks **4–6 directions**
   (moves: stop/start/combine/test/simplify) and writes **8–16 candidates** (`title, claim, why,
   nextStep, citedIds`). Apply (`persistGenerate` `:289`) grounds citations against
   `validMemoryIds`, embeds each candidate (title+claim) and runs the **novelty gate**. It then
   gathers evidence per contender (≤4 cited + ≤5 retrieved; earlier ideas never count) and
   **plans `idea_judge` in the same apply** (`:313`). With no non-repeat candidate, it archives all
   of them and ends the night with a skipped trace (`endNightEarly` `:264`).
2. **Novelty gate** (`ideas/novelty.ts`, `lib/data/ideas.ts` `findNearestIdeaNeighbours` `:65`).
   It takes the max cosine against three pools: the whole idea archive (archived and dismissed rows
   included), pending inbound proposals, and held beliefs. **≥0.88 `repeat`** → dropped before
   judging. **0.80–0.88 `borderline`** → the judge is asked "meaningfully different?". Below that
   → `novel`. A failed embed counts as novel (`embedFailures`).
3. **`idea_judge`** (`thinking/handlers/idea-judge.ts`). It is normally planned by the generate
   apply; its own `plan()` (`:46`) is recovery only. Deadline 45 min (`ideas/judge-context.ts:12`).
   A separate, sceptical system prompt critiques each candidate against its own evidence
   (`supports`/`contradicts`/`alreadyKnown`, plus `meaningfullyDifferent` for borderline ones). It
   votes on server-scheduled pairwise matches (`ideas/pairing.ts`: ~3 opponents each, every pair
   asked **in both orders**, legs a full schedule apart) and may refine its top two.
4. **Elo** (`ideas/elo.ts`): start 1000, K 32, sequential in schedule order. The same winner in
   both orders is a win; a split vote or a single vote is a draw; no vote changes nothing.
5. **Select** (`ideas/select.ts`). Candidates are eliminated in this order: `repeat` →
   `ungrounded` → `contradicted` → `already_known` → `not_different` → no supports. The rest are
   ranked by Elo, then wins. Up to **3 survivors**; after the top one, a survivor also needs Elo ≥
   1000 (otherwise `ranked_out`). Survivors carry `survivedBecause`.
6. **`writeTournament`** (`lib/data/ideas.ts:175`) is one transaction under an advisory lock on
   `idea_tournament:<date>`, plus a probe that makes a repeat submit idempotent. Survivors become
   **pending inbox proposals**: `type 'inbound'`, `streamClass 'agentic'`, `kind 'idea'`,
   `introspection: true`, `refers_to` evidence, `origin {kind:'kairos', via:'cron:idea-tournament'}`
   (`:22`). They are never beliefs: BackUp still needs outside support. Non-survivors become
   `type 'idea_candidate'`, `streamClass 'trace'`, archived on write. Both keep `sourceMetadata.idea`
   (`IdeaMeta`) and the embedding for future novelty checks. (Spec §6 shows
   `via: 'thinking:idea_judge'`; the code writes `cron:idea-tournament`.)
7. **Outcomes** — every accept/dismiss surface goes through `lib/kairos/proposal-accept.ts`
   (`groundIdeaOutcome` `:32`) → `recordIdeaOutcome` (`ideas.ts:359`), best-effort. Older rows are
   inferred (`inferIdeaOutcome` `:277`). `listIdeaOutcomes` / `listDirectionStats` feed the next
   night's generator and the weekly lessons.
8. **Diversity alarm** (`ideas/diversity.ts:49`): the mean pairwise cosine *distance* of the
   trailing 7 days' survivor embeddings. **< 0.15 with ≥3 survivors** raises the alarm ("Ideas are
   getting samey") in the daily message and the weekly review.
9. **Trace:** every finished or failed night writes `cronName 'idea-tournament'` (`ok`, `skipped`
   with `no_survivors`/`no_novel_candidates`, or failed with `generate_failed`/`judge_failed`; a
   missing BYOK key is a benign decline). This is armed in synthesis-health (below).

**Raw introspection retirement.** `isRawIntrospectionEnabled()` (`lib/kairos/introspection.ts:47`).
`KAIROS_RAW_INTROSPECTION` unset or `1` = the old dump still runs (default today). `0`/`off`/`false`
= `/api/cron/introspection` makes no model calls and writes one skipped `introspection` trace per
eligible user (`route.ts:59`, `raw_introspection_off`). The rule: flip it after **14 clean
`idea-tournament` nights**. `contradiction-scan` is unaffected.

### The Briefer (06:15 UTC, per Dominion — rewired in 0.14)
`lib/kairos/briefer.ts` (prompt) + `recipes/brief.ts` (BRIEF) via `dispatch.ts`. One
`streamClass='advisory'` memory per active Dominion per day, idempotent on
`briefer:{date}:{dominionId}`. **Grounding (P2.5 G5):** BRIEF declares
`reads: ['cortex','aether','constitution','belief',…]` (`brief.ts:139`), so `loadGrounding`
(`dispatch.ts:57`) loads the latest Aether and the Dominion-filtered conscience block alongside
`retrieveContext`. The prompt gains a **cortex** section (from `retrieval.cortex`, ≤1500 chars), an
**Aether digest** (narrative, 2 tensions, 3 threads — this Dominion first; `digestAether`
`brief.ts:32`) and the **conscience block** (`renderGrounding`, `briefer.ts:48`). The output format
is unchanged (State / Movement / Watch / Suggested next). The cron shares one per-run
`createConscienceLoader()` across a user's Dominions. The trace meta records which grounding was
present.

### Conscience block (0.14, injected at answer time)
`lib/kairos/conscience-context.ts` renders reference **data** inside
`<<<CONSCIENCE DATA…>>>` markers. It holds the live constitution's principles (numbered, with
reasons) and the top held beliefs, labelled *you hold* / *Kairos's own view*, Dominion first when
filtered. It ends with one instruction: if a reply conflicts with a principle, say which and why.
Caps: 12 principles, 12 beliefs, 6000 chars (≈1.5k tokens) (`:23-27`). Reads come from
`lib/data/conscience.ts` (`getConsciencePrinciples` `:19`; `listConscienceBeliefs` `:38`, ranked
by standing → confidence → recency). A read failure gives `''` and never breaks the caller.
**Injected into:** chat (`chat-turn-assistant.ts:257`), the daily message (routine draft
`thinking/handlers/daily-message.ts` + paid compose `daily-message.ts:99`), the weekly review
(`thinking/handlers/weekly-review.ts:80`), and BRIEF. **Deliberately absent** from the drift
probe, conscience checks, belief extraction, Aether, cortex, archetypes and introspection.

### Daily Message (08:00 Europe/London — the guaranteed voice)
`lib/kairos/daily-message{,-inputs,-prompt}.ts`. Cron `daily-message` fires `0 7,8 * * *` UTC,
gated by `isLondonHour(now, 8)`. It is idempotent on `kairos-daily:{londonDate}` + an advisory
lock, and sends to the Will inbox + Telegram via `deliverKairosSpeak` (`digest:true`; see
[chat.md](chat.md) §1b). Body source, in order: the routine's `daily_message` draft → paid BYOK →
deterministic template. The message covers briefs, Aether, the board day, promotions, new beliefs,
drift, one pending ask, synthesis health and mind-compare, plus:
- **Idea of the day** — the top *pending* survivor since the last window (`readIdeaOfTheDay`
  `daily-message-inputs.ts:211`), with "survived because …" and "(N more in your inbox)". The
  samey-ideas line appears when the diversity alarm fires (`ideaOfTheDayLines`
  `daily-message-prompt.ts:214`).
- **Late-idea append** — a routine draft is built from inputs gathered at plan time. If the draft
  doesn't mention the idea (`draftMentions` `daily-message.ts:26`), the idea line is appended
  deterministically, as long as the result still passes `rejectMessageText` (`:144`).
- **Conscience failure line** — `conscienceFailureLine` of the latest conscience run (failures
  only) rides the drift line as "Self-check failures" (`daily-message-inputs.ts:152`).
- The conscience block goes into both the routine and paid prompts.
A Telegram failure records `sent_inbox_only` + a `telegram_not_delivered` trace.

### Weekly review (Mondays)
`lib/kairos/weekly-review/{inputs,prompt,render}.ts` + the `weekly_review` job (Mon ≥05:00Z). Plan
vs actual over the week's board, objectives, belief changes, memory ops, mind-compare and asks;
**≤5 `review_action` proposals** + one summary speak. Additions in 0.15:
- **Belief diff** — `lib/data/belief-diff.ts` reads un-reverted `memory_ops` of steps
  `beliefs`/`recheck`/`own_mind` (≤500 rows). `classifyBeliefOp` (`inputs.ts:427`) labels each
  created / replaced / retired / reinforced / flagged / cleared / normalised / remapped.
  `buildBeliefDiff` (`:454`) shows the 15 most significant, grouped by domain with the logged
  reason (citable).
- **Ideas** — the week's survivors (≤21) with outcomes, the diversity reading (alarm flagged), and
  a 30-day **LESSONS** block. At most one action may be marked `ideaQuality` (`prompt.ts:224`).
- The conscience block is checked against every action and never cited.

### Drift probes + conscience checks (constitution)
`lib/kairos/constitution/{probes,drift}.ts` + `thinking/handlers/drift-probe.ts`. **Drift:** 24 fixed
probes answered from the constitution + held beliefs. The first run per (constitution version ×
embedding model) pins a baseline; later nights store a `drift_run:<day>` with per-probe cosine.
Alert at mean < 0.8 or ≥3 probes < 0.6. **Conscience checks (0.14):** the same `planDriftProbe`
(`:111`) queues a second job, **`drift_probe:<day>:conscience`** (`:77`). It is a separate call, so
it never touches drift answers or baselines. It runs with a constitution **or** ≥1 held belief
(`conscienceSpec` `:155`). One call answers the items in `constitution/conscience-probes.ts`:
- 4 both-sides **sycophancy** dilemma pairs (`:93`, pass when both framings agree);
- 3 **unknowable** questions (`:99`, pass on `unknown`);
- 2 synthetic **outdated-fact** fixtures (`:101`, the later correction must win);
- ≤5 same-mind belief pairs with cosine 0.75–0.95, checked for **contradiction** (`:105`);
- plus a deterministic **laundering audit** (`auditLaundering` `:171`): held beliefs on
  external-origin provenance, and operator beliefs with no operator source.
`persistConscience` (`drift-probe.ts:285`) merges the result into the day's `drift_run` as
`sourceMetadata.conscience`. An unparseable answer is stored as `unparsed`, never as a failed job.
This is measurement only: it is never fed back into a prompt, belief or constitution.

## Thinking queue (`thinking_jobs`, docs/kairos/33)

`lib/kairos/thinking/{queue,registry,deadlines,paid-fallback}.ts` + `handlers/*` (11 handlers,
`registry.ts:16`). Statuses go queued → claimed → done | failed | expired | fallback, with unique
`(userId, externalKey)`. A Claude Max **routine** claims and submits via MCP/REST; the server
validates, grounds, mints ids and persists. `PLAN_ORDER` (`queue.ts:44`): cortex → concept → aether
→ belief_extract → drift_probe → mind_compare → weekly_review → **idea_generate → idea_judge** →
daily_message → chat. `SWEEP_FALLBACK_KINDS` (`:57`): concept, belief_extract, drift_probe,
mind_compare, weekly_review, idea_generate, idea_judge. A late or rejected answer for these is
released to the sweep's paid key. Cron kinds fail over to their own cron.

| Kind | Planned | Deadline → fallback |
|---|---|---|
| `cortex` | after archetypes | 02:58Z → `cortex-regen` 03:00 |
| `aether` | after cortex | 03:13Z → `aether-regen` 03:15 |
| `concept` | Sundays (engine Concepts step) | 6h → sweep |
| `belief_extract` | ≥02:30Z (or on re-check flags alone) | 4h → sweep |
| `drift_probe` (+ `:conscience`) | after aether or ≥03:30Z | 2h → sweep |
| `mind_compare` | Mon ≥04:00Z | 3h → sweep |
| `weekly_review` | Mon ≥05:00Z | 6h → sweep |
| `idea_generate` | after aether or ≥03:30Z | 55 min → sweep |
| `idea_judge` | by the generate apply | 45 min → sweep |
| `daily_message` | once briefs exist | 07:55 London → own cron |
| `chat` | Telegram webhook only | watchdog → paid key (see [chat.md](chat.md)) |

**`thinking-sweep`** (hourly at :50) plans every kind except `concept`/`chat`
(`SWEEP_PLAN_SKIP_KINDS` `:80`), expires overdue jobs, and runs ≤2 paid fallbacks per invocation in
a 200s budget (`KAIROS_SWEEP_MAX_FALLBACKS` / `_BUDGET_MS`).

**Max-plan routines (claude.ai, operator-created; not inspectable from the repo).** All three new
ones are on `claude-opus-5-5`, use only the Aeon connector, and allow only Read/Glob/Grep tools.
Prompts are in docs/kairos/33.

| Routine | Trigger id | Cron (UTC) | Claims |
|---|---|---|---|
| Kairos thinking | `trig_01JX3JhyWYuJiNBh7tFtE4rv` | `40 2 * * *` | nightly kinds (aether…daily_message, never chat); usually done before ideas open |
| Kairos ideas | `trig_01MvjYWyfTMVS3fRd4dJrVzR` | `35 3 * * *` | `idea_generate` → `idea_judge` in one run |
| Kairos morning | `trig_01AxMddrzJMkgrk6Cd3WiWH3` | `30 6 * * *` | daily_message, drift_probe, mind_compare, weekly_review, belief_extract |
| kairos-brain-tick (older, Sonnet) | — | `0 6,11,17 * * *` | speaks first via `/api/v1/kairos/speak` ([chat.md](chat.md)) |

The first manual **Kairos ideas** run (18:14Z, 01/10) completed both stages on the routine. The
*Kairos chat* routine stays API-trigger only behind `KAIROS_TELEGRAM_ROUTINE=1`. **Crons that still
call the paid BYOK key directly:** briefer, introspection, contradiction-scan, archetype-synthesis,
chat-distill, ask-mine, micro-consolidate. cortex-regen, aether-regen, daily-message and the sweep
use the paid key only as a fallback.

## Recipes + dispatcher

`lib/kairos/dispatch.ts` → `runRecipe()` (`:78`) is the single entry for recipe writes. It runs one
canonical `retrieveContext()` **in parallel with `loadGrounding`** (Aether + conscience, only for
recipes whose `reads` declare `aether`/`belief`/`constitution`; best-effort). Every surface runs
`flat()`. The primary write goes through `captureMemory` (externalId idempotency), then a
`streamClass='trace'` audit row tied by `sourceMetadata.primaryMemoryId`. **BRIEF** (`recipes/brief.ts`)
is the sole registered recipe; the briefer cron, `runBriefingNow` and MCP `run_recipe` all use it.

## Cron cadence (`apps/web/vercel.json`, all gated on `CRON_SECRET`)

| UTC | Cron | What |
|---|---|---|
| 23:00 daily | `project-snapshot` | per-project snapshot + board feed + ephemeral lifecycle |
| 01:30 daily | `memory-engine` | Merge → Weigh → OwnMind → **Recheck** → BackUp → Concepts (`engine/registry.ts:27`; [memory-and-capture.md](memory-and-capture.md) §7) |
| hourly :50 | `thinking-sweep` | plan / expire / paid-fallback thinking jobs (incl. the idea tournament) |
| 02:00 daily | `chat-distill` | day's chat threads → operator reflections |
| 02:30 daily | `archetype-synthesis` | 3–7 archetypes / Dominion |
| 03:00 daily | `cortex-regen` | fallback for the `cortex` job |
| 03:15 daily | `aether-regen` | fallback for the `aether` job |
| 04:00 daily | `embed-backfill` | drain missing/stale embeddings |
| 04:30 daily | `ask-mine` | Kairos Asks + `card_notes` nudges |
| Mon 04:20 | `constitution-seed` | seed / maintain the live constitution |
| 05:00 daily | `contradiction-scan` | auto-contradiction detection |
| Sun 05:00 | `memory-dedup` | weekly near-duplicate supersession |
| 06:15 daily | `briefer` | one grounded advisory / Dominion |
| 06:30 daily | `introspection` | raw `inbound` proposals — **retiring** behind `KAIROS_RAW_INTROSPECTION` |
| 06:45 daily | `synthesis-health` | trace rollup → `SYNTHESIS_HEALTH` memory (see below) |
| 07:00 + 08:00 | `daily-message` | guaranteed 08:00 London speak |
| :15 at 6,9,12,15,18,21,23 | `micro-consolidate` | intraday per-Dominion `delta` fold |

**17 crons.** The ordering is deliberate: snapshot → engine → chat-distill → archetypes → cortex
→ aether → **idea tournament** (queue, 03:30Z+) → embed → contradiction → briefer → introspection
→ health → daily message. Each stage reads the fresh output of the one before it.

## synthesis-health (docs/kairos/31 + 35)

`lib/kairos/synthesis-health.ts` → `computeSynthesisHealth()`, pure SQL, no LLM. It buckets the last
48h of traces per stage per UTC night (failure wins) into one idempotent memory
(`synthesis-health:{date}`). Stage = `cronName`, with `BRIEF` → `briefer`. A stage failing **2
consecutive nights** fires one batched Telegram ops alert (outside the speak budget).
**Expected stages (0.15):** `EXPECTED_NIGHTLY_STAGES = ['idea-tournament']` (`:42`). A stage is
*armed* once seen and *disarmed* after 14 days unseen (`:44`). Arming state is carried in the rollup's
`sourceMetadata.expectedStages {since,lastSeen}`. An armed stage with no trace on a judged night
is marked `failed` and listed in `missingStages` (`applyExpectedStages` `:136`), so a tournament
that never ran alarms like one that crashed. A 0-survivor night is still `ok`. Yesterday is always
judged; today only from 08:00Z (`:47`). Because the scheduled run is 06:45Z, a missing night
surfaces the next morning (the code comment says "08:00Z cron"; the schedule is 06:45).

## Live Mind layer, tiers, caching (0.9–0.10, condensed)

- **Micro-consolidation** (`micro-consolidate.ts`) folds new memories + board deltas 6×/day into one
  `streamClass='delta'` memory per Dominion (`type='observation'`). It skips when there are fewer
  than 3 new items and uses an hour-bucket externalId. Cortex/Aether read it as "## Today so far".
- **Incident lifecycle:** a `resolves` link stamps targets' `invalidAt`. The `validAsOfNow` gate
  applies to archetype/cortex/aether inputs and trace retrieval.
- **Tiers** (`lib/ai/route-task.ts`): every cognition path runs heavy (Opus) by standing directive
  (07-24); classify/summarise/voice stay cheap. Thinking-queue paid fallbacks run heavy.
- **Caching:** synthesis calls pass `cacheSystem: true`, so system prompts must stay byte-exact
  static. Temperature is only set on chat (0.5) and chat-distill (0.1). `maxTokens` → `maxOutputTokens`
  (AI SDK v5) is what makes caps bind (idea generate 6000, conscience 2000).

## Key files

- `lib/kairos/{archetypes,cortex,aether,briefer,introspection,contradiction,chat-distill,daily-message,daily-message-inputs,daily-message-prompt,micro-consolidate}.ts`, `cron-trace.ts`, `version.ts` (log: `docs/kairos/CHANGELOG.md`)
- `lib/kairos/thinking/` (queue, registry, deadlines, paid-fallback, 11 handlers incl. `idea-generate.ts`, `idea-judge.ts`)
- `lib/kairos/ideas/` (`types`, `generate-prompt`, `judge-prompt`, `judge-context`, `novelty`, `pairing`, `elo`, `select`, `compose`, `diversity`); `lib/data/{ideas,idea-inputs}.ts`
- `lib/kairos/conscience-context.ts`, `lib/data/conscience.ts`; `constitution/` (seed, probes, drift, amendment, **conscience-probes**)
- `lib/kairos/weekly-review/`, `lib/data/belief-diff.ts`; `lib/kairos/proposal-accept.ts`
- `lib/kairos/synthesis-health.ts`; `dispatch.ts`, `recipes/{_recipe,registry,brief}.ts`, `retrieve.ts`, `_prompt-utils.ts`
- `apps/web/src/app/api/cron/*/route.ts`; `apps/web/vercel.json`; specs `docs/kairos/31–35`
