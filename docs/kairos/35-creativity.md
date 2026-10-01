# 35 — Creativity: the nightly idea tournament (P3)

Owner plan: `aeon_os/HANDOVER_0110.md` §4 and §7. Evidence: `research/kairos_2909/04_sota_five_modules.md`
§B Creativity + §C Creativity row, and `research/kairos_0110/00_verdict.md` §5. Shared contract:
`apps/web/src/lib/kairos/ideas/types.ts` (parent-owned; constants below are quoted from it).

## 1. Goal and evidence

Replace the raw nightly introspection dump (~40 pending proposals a day, almost never read) with a
**tournament** that keeps **1–3 ideas a night that survived critique**, each with the reason it survived.

| Evidence | Design consequence |
|---|---|
| Google Co-Scientist loop (generate → critique → pairwise Elo → evolve), Nature May 2026 | two-stage nightly batch job, Elo over pairwise matches |
| LLM ideas rate more novel than experts' before execution, ranking flips after execution (ICLR 2025/2026); "novelty mirage" | never trust LLM self-rating; anchor to operator outcomes (§6) |
| Diversity decays within weeks (~30k agents, Sep 2026); fixes: stratified directions, ordinary personas, vector novelty gate | 4–6 directions per night, no famous personas, novelty gate (§3), weekly alarm (§7) |
| Majority vote explains most debate gains (NeurIPS 2025); long debates drift 76–89% (EACL 2026) | short pairwise judgements, both orders, no debate |
| Nemori: keep only the surprising (+13–25%) — verdict §5 | critique asks "did memory already say this?" (`alreadyKnown`) |
| Echo / self-preference / laundering — verdict §5, G7 | survivors are `origin: kairos`; BackUp needs outside evidence |

## 2. Night flow

Two thinking kinds (doc 33 table), both routine-servable with the hourly sweep's paid-key fallback.

1. **`idea_generate`** — planned once tonight's aether is settled, ≥03:30Z, deadline 55 min (the sweep plans at :50; 55 makes the next sweep's expiry deterministic).
   The model picks `IDEA_DIRECTIONS_MIN..MAX` (4–6) distinct directions from the night's inputs and
   writes `IDEA_CANDIDATES_MIN..MAX` (8–16) candidates (`title`, `claim`, `why`, `nextStep`,
   `citedIds`). The server, in the same apply: grounds citations against `validMemoryIds`, assigns
   keys `c1..cN`, embeds, runs the novelty gate (§3), retrieves evidence per candidate, and **plans
   the `idea_judge` job**.
2. **`idea_judge`** — deadline 45 min from planning. A skeptical reviewer (a different system prompt
   from the generator) critiques each candidate against its evidence (`supports` / `contradicts` /
   `alreadyKnown`, and `meaningfullyDifferent` for borderline novelty), votes on the server-scheduled
   pairwise matches (§4), and may refine its top two (`refined: true`). The server computes Elo,
   selects survivors (§5), writes them to the inbox and archives every candidate (§6).
3. The night ends with one cron trace `cronName: 'idea-tournament'` — success (also when 0 survive)
   or failure (§8).

**Generate (`thinking/handlers/idea-generate.ts`, inputs `lib/data/idea-inputs.ts`).** Bounded, marker-delimited data (`<<<IDEA INPUT DATA>>>`, one line per item, fences neutralised): Aether narrative, tensions and top threads; open objectives; `board_day` pages of the last 3 days; top 20 held beliefs labelled *you hold* / *Kairos's own view*; recent concepts; the operator's own reflections of the last 7 days. Last-30-day idea outcomes and per-direction stats are soft priors and are not citable. A failed input source is recorded in `inputErrors`; the job still plans. Strict zod parse (moves: stop / start / combine / test / simplify; fewer than 4 candidates is rejected); citations are kept only from `validMemoryIds`. Prompt size: ~0.4k system + ≤ ~10k user tokens. Fallback: `askPaidAndParse` (heavy tier) with the valid ids as repair context.

## 3. Novelty gate

Max cosine of each candidate to the idea archive, pending proposals and held beliefs (`NoveltyResult`
records the nearest id and whether it was an idea, proposal or belief):

| max cosine | class | effect |
|---|---|---|
| ≥ `NOVELTY_REPEAT_COSINE` (0.88) | `repeat` | dropped before judging, archived `status: 'repeat'` |
| `NOVELTY_BORDERLINE_COSINE` (0.80) – 0.88 | `borderline` | judged; the judge is asked "meaningfully different?" — no → `not_different` |
| < 0.80 | `novel` | judged |

**Novelty (`lib/data/ideas.ts` `findNearestIdeaNeighbours`, `lib/kairos/ideas/novelty.ts`).** Each candidate is embedded (title + claim, Voyage `document`; a failed embed counts as novel and is counted in `embedFailures`). Nearest by cosine in three pools inside one transaction (`SET LOCAL hnsw.ef_search = 100`): the whole idea archive (archived, dismissed and eliminated ideas included, so a vetoed idea can't return reworded), pending non-idea inbound proposals, and live held beliefs of both minds. The highest similarity decides. Evidence per contender: up to 4 cited ids + up to 5 live memories from the chat substrate; earlier Kairos ideas never count as evidence.

## 4. Elo and both-orders matches

- Every judged candidate starts at `ELO_START` (1000), `K = ELO_K` (32).
- The server schedules `MATCHES_PER_CANDIDATE` (3) pairwise matches per candidate. Each match is put to
  the judge **in both orders** (A-vs-B and B-vs-A) to cancel position bias.
- The same winner in both orders is a win; a split verdict (position bias) or a single surviving vote
  is a draw; no usable vote leaves both ratings alone.
- Short single-turn judgements only; no debate rounds.

Matches are scheduled deterministically (round-robin-lite, ~3 opponents per candidate, `ideas/pairing.ts`); each pair appears twice with the order swapped under separate match ids, never adjacent. A pair whose two votes disagree, or that has only one vote, counts as a draw. Elo (`ideas/elo.ts`) starts at 1000 with K = 32 and is updated match by match in schedule order. The judge (`thinking/handlers/idea-judge.ts`) has its own sceptical-reviewer system prompt; votes may be given by key or A/B. Its prompt is ~7k tokens for 12 candidates (≤16k worst case).

## 5. Selection and elimination

Up to `IDEA_SURVIVORS_MAX` (3) survivors, by Elo, from candidates that pass every check. Every
non-survivor is archived with `eliminatedReason`:

| reason | meaning |
|---|---|
| `repeat` | novelty gate ≥ 0.88 |
| `ungrounded` | critique found no supporting evidence, or no valid citations survived grounding |
| `contradicted` | evidence contradicts the claim |
| `already_known` | memory already said this (no surprise) |
| `not_different` | borderline novelty and the judge said it is not meaningfully different |
| `ranked_out` | passed every check but lost on Elo |

Each survivor carries `survivedBecause` — one line shown in the inbox and the daily message.

## 6. Survivors, archive, outcomes, lessons

**Survivor → inbox proposal** (never straight to a belief):

```ts
{ type: 'inbound', streamClass: 'agentic', source: 'cron',
  sourceMetadata: { introspection: true, kind: 'idea' /* IDEA_PROPOSAL_KIND */, status: 'pending',
    origin: { kind: 'kairos', via: 'thinking:idea_judge' }, citations: string[], idea: IdeaMeta },
  links: [{ type: 'refers_to', target, target_kind: 'memory' }] /* evidence */ }
```

- `origin: kairos` → the echo cap applies (doc 34, P2.5). A survivor reaches the **own mind** only through
  the memory engine's BackUp, which needs ≥1 operator or activity support (the P2.5 anchor) on top of
  ≥2 independent supports on ≥2 days. Never promoted by the tournament itself.
- **Archive:** every non-survivor is written as `type: 'idea_candidate'` (`IDEA_CANDIDATE_TYPE`),
  `streamClass: 'trace'`, archived on write, with `sourceMetadata.idea` (`IdeaMeta`). It never grounds
  retrieval or gets scored; it exists for future novelty checks and review.
- **Outcomes:** operator accept / dismiss on a survivor sets `idea.outcome` (`accepted` | `dismissed`)
  and `outcomeAt`, and flows through the existing reactions (doc 32 Outcome scorer).
- **Lessons:** outcomes are the first source of the lessons memory (verdict G11) — what kind of idea gets
  acted on vs dismissed, fed back to the next nights' generate prompt.

**Archive writer (`writeTournament`).** One transaction, an advisory lock on `(user, idea_tournament:<date>)` plus a probe for rows with that `idea.tournamentDate`, so a double submit returns the existing ids. Survivors: `type 'inbound'`, `streamClass 'agentic'`, `kind 'idea'`, `introspection: true`, `status 'pending'`, `refers_to` their cited evidence, tags `proposal, idea`. Others: `type 'idea_candidate'`, `streamClass 'trace'`, archived on write. Both carry `sourceMetadata.idea` (IdeaMeta), the embedding, and `origin = { kind: 'kairos', via: 'cron:idea-tournament' }`. Readers: `listSurvivorsSince`, `listIdeaOutcomes`, `listDirectionStats`, `listSurvivorEmbeddingsBetween`.
**Outcomes and lessons.** Every accept or dismiss path (inbox, Telegram, MCP, REST, all through `lib/kairos/proposal-accept.ts`) calls `recordIdeaOutcome` after the usual reactions, best-effort, stamping `idea.outcome` / `idea.outcomeAt` (found by id, so it survives the accept retyping the row). Older rows are inferred: accepted is accepted; archived while still pending is dismissed; BackUp decay/promotion is not an operator outcome. The lessons are the outcomes themselves: the generator reads the last 30 days of accepted vs dismissed ideas and per-direction stats as soft priors, and the weekly review shows them with at most one `ideaQuality` action.

## 7. Weekly diversity alarm

Mean pairwise cosine **distance** of the week's survivors. Below `DIVERSITY_ALARM_DISTANCE` (0.15) →
a collapse warning in the weekly review and the daily message.

Mean pairwise cosine distance of the embeddings of the trailing 7 days' survivors (`ideas/diversity.ts` `weeklyIdeaDiversity`). Alarm when it is below 0.15 with at least 3 survivors.

## 8. Daily message, weekly review, health

- **Daily message — "Idea of the day":** the top survivor of last night and its `survivedBecause`.
- **Weekly review:** the week's survivors with outcomes, the diversity figure (alarm if collapsed),
  and the belief diff (verdict G13).

**Inbox:** idea proposals lead the proposals, with an "Idea" label, claim, why, next step and "Survived because …". **Daily message:** the top pending survivor of the last 24 h is the "Idea of the day" with "(N more in your inbox)"; with the diversity alarm on, "Ideas are getting samey this week". Present in the model prompt and the deterministic fallback; a failed read lands in `failed` and never blocks the message; an empty night shows nothing. **Weekly review:** the week's survivors with outcomes and the diversity reading, a 30-day lessons block, and the belief diff (doc 34 §4).

**Health (doc 31):** the tournament writes `cronName: 'idea-tournament'` via `writeCronFailureTrace` /
`writeCronSuccessTrace`. A night with 0 survivors is a **success** trace (counters go in `details`;
never a `reason` key — any `reason` reads as failure). `synthesis-health` lists `idea-tournament` in
`EXPECTED_NIGHTLY_STAGES`: once a user's tournament has traced at least once (armed; disarmed after
14 days unseen), a judged night with no trace is marked `failed` and listed in the rollup's
`missingStages`. Yesterday is always judged; today only from 08:00Z, so the scheduled 06:45Z rollup reports a missing night the next morning. Two failed or missing nights
in a row → the usual 2-strike ops alert.

## 9. Retirement of raw introspection

`KAIROS_RAW_INTROSPECTION` (Vercel env, read by `/api/cron/introspection`):

| value | behaviour |
|---|---|
| unset or `1` (default today) | raw introspection runs as before |
| `0` / `off` / `false` | no model calls, no proposals; one `introspection` success trace per eligible user, `outcome: 'skipped'`, `skipReason: 'raw_introspection_off'`; response `{ ran: 0, skipped: 'raw_introspection_off' }` |

**Rule:** switch it to `0` after the tournament has **2 clean weeks**: 14 consecutive nights of
`idea-tournament` traces with no failed or missing night in the synthesis-health rollup. Then remove
the cron from `vercel.json` in a later cleanup.

Nothing else is lost: introspection only writes idea-type proposals (reflection / tension / connection /
question). Contradiction proposals come from `contradiction-scan`, a separate cron that stays on;
constitution drafts come from `constitution-seed`. The BackUp candidate pool shrinks to survivors +
those.

## 10. Watch list

| When | What to confirm | How |
|---|---|---|
| first night after deploy, ~03:30–06:00Z | generate planned after aether, judge planned by its apply, both done or swept | `thinking_jobs` rows `idea_generate:*` / `idea_judge:*`; trace `idea-tournament` |
| first nights | 1–3 survivors in the inbox with `survivedBecause`; non-survivors archived with reasons | inbox; `idea_candidate` rows |
| 06:45Z rollup | `idea-tournament` appears in `byStage`; `expectedStages` armed | `get_trace_history({recipe:'SYNTHESIS_HEALTH',limit:1})` |
| sweep load | the 2-fallbacks-per-sweep cap still clears the tournament before 08:00Z | `thinking-sweep` trace `deferred` |
| first Monday | diversity figure and survivor outcomes in the weekly review | weekly review observation |
| +2 weeks clean | set `KAIROS_RAW_INTROSPECTION=0` | §9 |
