# Vorath (formerly Kairos) — Synthesis Pipeline

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [chat](chat.md) · [mind](mind.md)

Synthesis turns flat accumulation into a layered, self-consolidating brain. Each stage reads the
substrate (and the stage below) and distils one tier up, writing back into `memories` with a
dedicated `streamClass`. All stages are per-user, idempotent per UTC day, soft-archive their
priors transactionally (never leaving a tier empty on a failed insert), and skip gracefully on
missing/undecryptable BYOK keys. State as of **Kairos 0.19.0 "No paid spend, chat on Max, one
setup checklist"** / app **v0.36.0** (0.20–0.28 additions — incl. the Living Dominions focus gate on archetype/cortex/concept/aether/idea planning and the `card_triage` kind — are in [mind.md](mind.md)) (`lib/kairos/version.ts`, `lib/version.ts`). Since 0.17 every
stage is first a thinking job answered by the **Vorath brain** routine on the owner's Max plan; the
crons below are fallbacks only, and they run only while the owner's **paid backup** switch is on.

**Parse reliability (docs/kairos/31).** The paid-key generators (archetypes, cortex, aether, the
concept step, the constitution seed and the sweep's `paid-fallback.ts`) wrap `extractJsonBlock → zod.parse()` in `parseWithRepair`
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
(live archetype created or confirmed today, `isNull(archivedAt)`). **Edited in place** since Wave 1
(09/10, `archetype-persist.ts` + `archetype-match.ts`): each generated archetype is matched to a live one
by normalised title/summary overlap — unchanged → kept (only `sourceMetadata.confirmedAt` stamped),
changed → updated with the same id and an `archetype_update` memory_ops row (undoable like
`concept_update`), unmatched → inserted, live but not returned → archived; pinned rows are never
edited or archived.

**Change checks (Wave 1, `lib/kairos/synthesis-change.ts`).** Archetypes, cortex and aether skip
instead of rewriting when nothing new arrived since their last live output: archetypes/cortex need a
new non-synthesis memory in the Dominion (cortex also counts archetype edits) or a Dominion edit;
aether needs a cortex written since the live aether. Output older than 7 days refreshes regardless.
A skip plans no thinking job (nothing owed, so brain status never shows it missed) and the fallback
cron writes a `skipped` trace (health = ok).

### Cortex (03:00 UTC fallback, per Dominion — the living document)
`lib/kairos/cortex.ts` → `runCortexRegenForDominion()`. Reads Dominion strategy, live cards,
reflections (≤30), today's archetypes (≤12), the prior cortex and a "Today so far" line for the day
being folded: old intraday deltas if any exist (none are written since micro-consolidation was retired
in 0.17, so this falls back to a new-memory count) plus, since 0.18, the titles of cards finished
that day on **watched boards** (same-day `board_card_done` rows). Emits
one `dominion_cortex` memory (`streamClass='cortex'`; markdown + `sourceMetadata.cortex`).
**Race defense:** a Dominion with activity but no archetypes today defers. Normally served by the
`cortex` thinking job; the cron covers anything unanswered by 02:58Z.

### Aether (03:15 UTC fallback, global self-model)
`lib/kairos/aether.ts` → `runAetherForUser()`. One cross-Dominion self-model per UTC day from
the latest cortex per Dominion, top-40 reflections, today's archetypes and the prior Aether. Payload
`{ thoughts[], tensions[], shifts[], coreNarrative }`. **Anti-drift leash:** thoughts with zero
`sourceMemoryIds` are stripped; none left → nothing written. Its **tensions feed the idea
tournament** and the daily message reads it. Doc: `docs/kairos/27-aether-the-living-intelligence.md`.

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

**Raw introspection is retired (0.17).** The raw introspection dump, its cron and the
`KAIROS_RAW_INTROSPECTION` flag are gone; the idea tournament is the only source of idea proposals.
The contradiction scan (cron and `contradiction` kind) was retired in the same release (audit:
`research/kairos_0210/02_brain_jobs_audit.md`). `introspection-prompt.ts` survives only as the shared
id-resolver helpers (`makeFedIdResolver`, `fedIdListSchema`) for other prompts.

### The Briefer — retired in 0.17
The per-Dominion morning briefs, now retired (`brief` kind, briefer cron, BRIEF recipe, `briefer.ts`,
`dispatch.ts`) are retired. The daily message reads each area's latest **cortex headline**
(`readAreaHeadlines`, `daily-message-inputs.ts`) instead, and the inbox filters out old advisory rows.

### Conscience block (0.14, injected at answer time)
`lib/kairos/conscience-context.ts` renders reference **data** inside
`<<<CONSCIENCE DATA…>>>` markers. It holds the live constitution's principles (numbered, with
reasons) and the top held beliefs, labelled *you hold* / *Kairos's own view*, Dominion first when
filtered. It ends with one instruction: if a reply conflicts with a principle, say which and why.
Caps: 12 principles, 12 beliefs, 6000 chars (≈1.5k tokens) (`:23-27`). Reads come from
`lib/data/conscience.ts` (`getConsciencePrinciples` `:19`; `listConscienceBeliefs` `:38`, ranked
by standing → confidence → recency). A read failure gives `''` and never breaks the caller.
**Injected into:** chat (`chat-turn-assistant.ts:257`), the daily message (routine draft
`thinking/handlers/daily-message.ts` + paid compose `daily-message.ts`) and the weekly review
(`thinking/handlers/weekly-review.ts`). **Deliberately absent** from the drift probe, conscience
checks, belief extraction, Aether, cortex and archetypes.

### Daily Message (06:00 Europe/London — the guaranteed voice, since 0.18)
`lib/kairos/daily-message{,-inputs,-prompt,-time}.ts` + `daily-brief.ts`. Cron `daily-message` fires `0 5,6 * * *` UTC,
gated by `isLondonHour(now, DAILY_MESSAGE_HOUR)` (`= 6`). It is idempotent on
`kairos-daily:{londonDate}` + an advisory lock, and sends to the Will inbox + Telegram via
`deliverKairosSpeak` (`digest:true`; see [chat.md](chat.md) §1b). Body source, in order: the
routine's `daily_message` draft → paid BYOK (only with paid backup on) → deterministic template
(always free, so the message is sent even with paid backup off). The inbox pins today's message.
The message covers each area's latest cortex headline (`readAreaHeadlines`, since 0.17), Aether,
the board day, promotions, new beliefs, drift, synthesis health and mind-compare (Mondays), plus:
- **Open questions** (0.18) — code, never the model, appends a numbered block of every unanswered
  Kairos ask (`appendOpenQuestionsBlock`, `daily-message-prompt.ts`). Numbers come from
  `kairosAsk.seq` (stable per user); cap 10, 14-day expiry, `dismissed` status. On Telegram,
  `Q12: …` answers and `skip Q12` dismisses (`lib/kairos/ask-numbered.ts`, routed before chat);
  MCP/REST `list_open_kairos_asks` / `dismiss_kairos_ask` expose the same list, and
  `answer_asks_from_message` lets Triad relay a message (or a thread reply under a Q card) through
  the same parsing.
- **What I now believe** — a deterministic beliefs block, appended after the guard.
- **Idea of the day** — the top *pending* survivor since the last window (`readIdeaOfTheDay`),
  with "survived because …" and "(N more in your inbox)". The samey-ideas line appears when the
  diversity alarm fires (`ideaOfTheDayLines`).
- **Late-idea append** — a routine draft is built from inputs gathered at plan time. If the draft
  doesn't mention the idea (`draftMentions`), the idea line is appended deterministically, as long
  as the result still passes `rejectMessageText`.
- **Conscience failure line** — `conscienceFailureLine` of the latest conscience run (failures
  only) rides the drift line as "Self-check failures".
- The conscience block goes into both the routine and paid prompts.
A Telegram failure records `sent_inbox_only` + a `telegram_not_delivered` trace.
- **Short brief on Telegram** (Wave 2, 09/10) — the inbox stores the full message above; Telegram
  gets `buildDailyBrief` (`daily-brief.ts`, ≤800 chars, `DAILY_BRIEF_MAX_CHARS`) via speak's
  Telegram-only `telegramText`: a bold headline (the draft's first line — the prompt now asks for
  a headline first and a `Next: …` look-ahead last), at most 3 verdict items (idea → oldest `Q` →
  first `R` → goal proposal → `P` due, then the rest; numbers kept), one look-ahead line (the
  draft's `Next:`, else Horae / goal / promise), then `+N more in your inbox.` (or "The full
  brief is in your inbox."). Nothing pending and nothing notable → one quiet line, never nothing.
- **Keep / Drop buttons** — the idea in the brief gets `✅ Keep` / `❌ Drop` on the existing
  `accept:<id>` / `dismiss:<id>` callbacks (`idea-verdict-keyboard.ts`), replacing the self-Dismiss
  (no idea → an "Open in Aeon" link, or the Dismiss if no app URL). The webhook spots a verdict
  button from the message's own keyboard, checks the tap is the owner's, runs the same
  `acceptInboxProposal` / `dismissInboxMemory` with origin `operator/telegram` (so taste learns),
  answers "✓ kept" / "✓ dropped" and collapses that row (`idea-verdict-telegram.ts`).
- **Sunday verdict deck** (Wave 2, 09/10) — on Sunday (London, `isLondonSunday`) the same 06:00 run
  (no new cron or thinking kind) swaps the brief for one numbered deck (`lib/kairos/verdict-deck/`):
  every item waiting on the owner — pending idea survivors, open `Q`s, `R`s due (predictions switch
  on), pending goal / card-tree proposals — numbered 1..N oldest
  first, ≤10 shown, one clipped line each, `+N more in your inbox.`, footer `Reply e.g. "1y 2n 3
  skip"`; nothing waiting → the quiet line; a failed gather → the ordinary brief. Speak's
  `telegramOnSent` captures the sent message id; after Telegram delivered, the number → item map
  is stored in the server-owned `kairosVerdictDeck` pref (`lib/data/kairos-verdict-deck.ts`, latest
  deck only, no migration). The webhook routes a deck reply first (before Q/R/D/P/A and chat): text
  that is ONLY bare numbered verdicts (`y/yes/✅/keep`, `n/no/❌/drop`, `s/skip`) replying to that
  message, or sent on the deck's London day (a "no" only on a reply to the deck). Verdicts go to the
  existing owner handlers with origin `operator/telegram` (idea accept/dismiss, Q "n" sets it aside
  and "y" asks for the answer text, R right/wrong, proposal approve/veto); the decision journal is never in the deck (it stays private to the owner); skip touches nothing; unknown numbers are reported; one-line ack
  `✓ 1 kept · ✓ 2 dropped · 3 skipped · 4 unknown`.
- **Idea expiry** — before composing (never on a dry run), `expireStaleIdeaProposals`
  (`lib/data/idea-expiry.ts`) archives pending, undecided idea survivors older than 7 days with
  `status`/`idea.outcome` `'ignored'` — never deleted; taste and stepping stones read them as
  ignored (`stones.ts` `rowOutcome`). A failure traces `idea-expiry` and never costs the message.

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

`lib/kairos/thinking/{queue,registry,deadlines,paid-fallback}.ts` + `handlers/*` (25 handlers as of 0.28, one
per kind). Statuses go queued → claimed → done | failed | expired | fallback, with unique
`(userId, externalKey)`. A Claude Max **routine** claims and submits via MCP/REST; the server
validates, grounds, mints ids and persists. `PLAN_ORDER` = `PLANNED_THINKING_KINDS` + `chat`
(`queue.ts`): chat_distill → archetype → cortex → concept → aether → belief_extract → drift_probe
→ mind_compare → constitution_seed → weekly_review → **idea_generate → idea_judge** → ask_mine →
daily_message → chat. `PLANNED_THINKING_KINDS` must equal the routine catalog's `BRAIN_JOBS`
(`thinking/__tests__/planned-kinds.test.ts`). `SWEEP_FALLBACK_KINDS`: concept, belief_extract,
drift_probe, mind_compare, weekly_review, idea_generate, idea_judge. A late or rejected answer for
these is released to the sweep's paid key. Cron kinds fail over to their own cron. A claim that
still names retired kinds has them dropped instead of failing.

| Kind | Planned | Deadline → fallback |
|---|---|---|
| `chat_distill` | 01:00Z, one per thread with yesterday's operator messages | 01:58Z → `chat-distill` 02:00 |
| `archetype` | 01:36Z, after tonight's chat distill | 02:28Z → `archetype-synthesis` 02:30 |
| `cortex` | after archetypes | 02:58Z → `cortex-regen` 03:00 |
| `aether` | after cortex | 03:13Z → `aether-regen` 03:15 |
| `concept` | Sundays (engine Concepts step) | 6h → sweep |
| `belief_extract` | ≥02:30Z (or on re-check flags alone) | 4h → sweep |
| `drift_probe` (+ `:conscience`) | after aether or ≥03:30Z | 2h → sweep |
| `idea_generate` | after aether or ≥03:30Z | 55 min → sweep |
| `idea_judge` | by the generate apply | 45 min → sweep |
| `ask_mine` | 03:15Z, once aether is settled | 04:28Z → `ask-mine` 04:30 |
| `mind_compare` | Mon ≥04:00Z | 3h → sweep |
| `constitution_seed` | Mon 04:00–05:56Z, only while there is no constitution and no pending draft | 05:56Z → `constitution-seed` Mon 05:58 |
| `weekly_review` | Mon ≥05:00Z | 6h → sweep |
| `daily_message` | from 04:00Z once aether, ideas and ask are settled (from 04:35Z regardless), only when the UTC date equals the London date | 05:55 London → own cron 06:00 London |
| `chat` | a web (`/kairos`) or Telegram message only | watchdog → paid key, if paid backup is on (see [chat.md](chat.md)) |

**`thinking-sweep`** (hourly at :50) plans every kind except `concept`/`chat`
(`SWEEP_PLAN_SKIP_KINDS`), expires overdue jobs, and runs ≤2 paid fallbacks per invocation in
a 200s budget (`KAIROS_SWEEP_MAX_FALLBACKS` / `_BUDGET_MS`). With paid backup off it closes each
pending fallback with "paid backup off" instead of running it.

**Max-plan routines (claude.ai).** Every Kairos model call is a thinking job first (30 kinds incl. chat; the 0.20+ kinds are listed in [mind.md](mind.md)). Each former paid-key cron plans its kind in a window closing 2 min before the cron, and the
cron is only the **fallback**: `isJobDone(userId, externalKey)` (`lib/data/thinking-jobs.ts`) skips
any unit a routine answered. Since 0.21 there are **three routines, defined in code** (brain, chat, pulse; claims are routine-scoped by `allowedKinds` since 0.20):
`lib/kairos/routines/catalog.ts` is the single source of truth (names, schedules, caps, model and the
exact self-contained prompts), and the in-app *Set up Kairos* checklist renders them with copy
buttons. Brain and chat use the registry's `routine` model (Opus), pulse the `cheap` model (Sonnet; shared model registry `defaults`), Aeon connector only (prompts and caps in
docs/kairos/33):

| Routine | Trigger (UTC) | Claims | Caps |
|---|---|---|---|
| Vorath brain | cron `40 * * * *` (hourly since 0.21) | every due deep kind except chat | 40 jobs / 50 min |
| Vorath pulse | cron `10 6-21 * * *` | light kinds (`pulse`); idle until `KAIROS_DAYTIME_THINKING=1` | 3 jobs / 10 min |
| Vorath chat | API trigger, fired once per chat message (web and Telegram, since 0.19) | `{"kinds":["chat"]}` | 5 jobs / 5 min |

The six older routines and the Sonnet brain-tick are retired (`RETIRED_ROUTINE_NAMES` in the catalog;
the setup guide tells the owner to delete them). The chat routine is behind `KAIROS_CHAT_ROUTINE`
(alias `KAIROS_TELEGRAM_ROUTINE`) + `ROUTINE_CHAT_ID` / `ROUTINE_CHAT_TOKEN`; off, chat answers
inline on the paid key.

**Paid backup switch (0.19).** `user_preferences.preferences.kairosPaidBackup`, default on (theme
saves can't overwrite it). Off, `getModelForUser` (`lib/ai/router.ts`) throws `PaidBackupOffError`,
so every Kairos paid path declines: the fallback crons skip via `lib/kairos/paid-backup-cron.ts`,
the sweep closes its fallbacks, the chat watchdog sends a short "couldn't answer on Max" note, and
the daily message falls back to its free deterministic template. Exposed as MCP
`get/set_kairos_paid_backup`, REST `GET/PUT /api/v1/kairos/paid-backup` (parity test), and a switch
in the Health tab.

## Recipes + dispatcher — retired in 0.18

The BRIEF recipe (its only recipe), `dispatch.ts`, the retired MCP tool and `/api/v1/recipes/run` are
gone. What remains: `recipes/_recipe.ts` (shared retrieval types used by `retrieve.ts`) and the
read-only trace surface, MCP `get_trace_history` ↔ REST `GET /api/v1/recipes/traces`.

## Cron cadence (`apps/web/vercel.json`, all gated on `CRON_SECRET`)

| UTC | Cron | What |
|---|---|---|
| 23:00 daily | `project-snapshot` | per-project snapshot + board feed + ephemeral lifecycle |
| 01:30 daily | `memory-engine` | Merge → Weigh → OwnMind → **Recheck** → BackUp → Concepts (`engine/registry.ts`; [memory-and-capture.md](memory-and-capture.md) §7) |
| hourly :50 | `thinking-sweep` | plan / expire / paid-fallback thinking jobs (incl. the idea tournament) |
| 02:00 daily | `chat-distill` | fallback for `chat_distill`: day's chat threads → operator reflections |
| 02:30 daily | `archetype-synthesis` | fallback for `archetype`: 3–7 archetypes / Dominion |
| 03:00 daily | `cortex-regen` | fallback for the `cortex` job |
| 03:15 daily | `aether-regen` | fallback for the `aether` job |
| 03:25 daily | `embed-backfill` | drain missing/stale embeddings (no model-call fallback; embeddings use the app key) |
| 04:25 daily | `synthesis-health` | trace rollup → `SYNTHESIS_HEALTH` memory (see below) |
| 04:30 daily | `ask-mine` | fallback for `ask_mine`: Kairos Asks + `card_notes` nudges |
| Mon 05:58 | `constitution-seed` | fallback for `constitution_seed` (BYOK users only) |
| 05:00 + 06:00 | `daily-message` | guaranteed 06:00 London speak (London-hour gate) |

**12 crons.** The paid-key fallbacks skip when the owner's paid backup is off. Retired in 0.17:
the briefer, introspection, contradiction scan, micro-consolidation and weekly dedup crons. The
ordering is deliberate: snapshot → engine → chat-distill → archetypes → cortex → aether → **idea
tournament** (queue, 03:30Z+) → embed → health → ask → daily message. Each stage reads the fresh
output of the one before it.

## synthesis-health (docs/kairos/31 + 35)

`lib/kairos/synthesis-health.ts` → `computeSynthesisHealth()`, pure SQL, no LLM. It buckets the last
48h of traces per stage per UTC night (failure wins) into one idempotent memory
(`synthesis-health:{date}`). Stage = `cronName` (the old BRIEF alias was retired with its cron in
0.17; retired stages simply stop appearing). A stage failing **2
consecutive nights** fires one batched Telegram ops alert (outside the speak budget).
**Expected stages (0.15):** `EXPECTED_NIGHTLY_STAGES = ['idea-tournament']`. A stage is
*armed* once seen and *disarmed* after 14 days unseen. Arming state is carried in the rollup's
`sourceMetadata.expectedStages {since,lastSeen}`. An armed stage with no trace on a judged night
is marked `failed` and listed in `missingStages` (`applyExpectedStages`), so a tournament
that never ran alarms like one that crashed. A 0-survivor night is still `ok`. Yesterday is always
judged; today only from 08:00Z. Because the scheduled run is 04:25Z, a missing night
surfaces the next morning.

## Live Mind layer, tiers, caching (0.9–0.10, condensed)

- **Micro-consolidation** was retired in 0.17 (only the next night read it). Old `streamClass='delta'`
  rows stay readable; cortex/Aether still show them under "## Today so far" when present.
- **Incident lifecycle:** a `resolves` link stamps targets' `invalidAt`. The `validAsOfNow` gate
  applies to archetype/cortex/aether inputs and trace retrieval.
- **Tiers** (`lib/ai/route-task.ts`): every cognition path runs heavy by standing directive
  (07-24); classify/summarise/voice stay cheap. Thinking-queue paid fallbacks run heavy. Tier
  models and effort come from the shared model registry ([../platform.md](../platform.md) §5).
- **Caching:** synthesis calls pass `cacheSystem: true`, so system prompts must stay byte-exact
  static. Temperature is only set on chat (0.5) and chat-distill (0.1). `maxTokens` → `maxOutputTokens`
  (AI SDK v5) is what makes caps bind (idea generate 6000, conscience 2000).

## Key files

- `lib/kairos/{archetypes,cortex,aether,chat-distill,ask-mine,daily-message,daily-message-inputs,daily-message-prompt,ask-numbered,paid-backup,paid-backup-cron}.ts`, `cron-trace.ts`, `version.ts` (log: `docs/kairos/CHANGELOG.md`)
- `lib/kairos/routines/` (`catalog.ts` — the three routines, prompts, `BRAIN_JOBS`; `setup.ts` — connector install link); `lib/data/brain-status.ts`
- `lib/kairos/thinking/` (queue, registry, deadlines, paid-fallback, 25 handlers incl. `card-triage.ts`, `idea-generate.ts`, `idea-judge.ts`, `constitution-seed.ts`)
- `lib/kairos/ideas/` (`types`, `generate-prompt`, `judge-prompt`, `judge-context`, `novelty`, `pairing`, `elo`, `select`, `compose`, `diversity`); `lib/data/{ideas,idea-inputs}.ts`
- `lib/kairos/conscience-context.ts`, `lib/data/conscience.ts`; `constitution/` (seed, probes, drift, amendment, **conscience-probes**)
- `lib/kairos/weekly-review/`, `lib/data/belief-diff.ts`; `lib/kairos/proposal-accept.ts`
- `lib/kairos/synthesis-health.ts`; `recipes/_recipe.ts` (retrieval types only), `retrieve.ts`, `_prompt-utils.ts`
- `apps/web/src/app/api/cron/*/route.ts`; `apps/web/vercel.json`; specs `docs/kairos/31–35`
