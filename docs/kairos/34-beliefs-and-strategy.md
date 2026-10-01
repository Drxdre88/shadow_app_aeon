# 34 — Beliefs, Constitution and Strategy (P2)

Owner steer (3009): Kairos keeps **two minds side by side** — one aligned with the operator, one that grows on its own —
so the operator can compare them and judge whether both are worth keeping. One daily message at **08:00 UK**,
a weekly review, Telegram chat on the Max plan. Evidence base: `research/kairos_2909/04_sota_five_modules.md` §C
(Philosophical / Strategic rows). Builds on the memory engine (doc 32) and thinking queue (doc 33).

## 1. Taxonomy (no migration — varchar columns)

| type | streamClass | trust | what |
|---|---|---|---|
| `belief` | `belief` | 0.8 | one claim in a mind |
| `constitution` | `constitution` | 0.95 | the operator's reasons-based principles; ONE live version per user, versioned by supersession |

Both are excluded from Merge and never machine-deleted. `sourceMetadata.belief`:

```ts
{ v: 1, mind: 'aligned' | 'own', domain: string /* Dominion name or 'general' */, dominionId: string | null,
  claim: string, reasons: string[], falsifier: string /* what evidence would change it */,
  sourceType: 'operator' | 'tool' | 'inference', provenance: string[] /* memory ids */,
  status: 'held' | 'retired', confidence: number, supersedes?: string }
```

- **aligned mind** — extracted from the operator's own words (reflections, dialogue notes, answered asks, board notes).
  `sourceType:'operator'`. Never written from chat directly; only via the daily `belief_extract` job (Max routine, or
  the sweep's paid-key fallback), which writes held beliefs directly. There is no proposal/acceptance step for
  beliefs today (future).
- **own mind** — Kairos's independent view: every engine `promote` (doc 32 §2.3) becomes an own belief
  (`sourceType:'inference'`, mirrored by the nightly memory-engine run). Reverting the promotion retires its mirror;
  the operator can veto but does not steer it. `mind_compare` does **not** propose own beliefs — it only writes the
  comparison (proposing own beliefs from it is future work).
- **Comparison** — weekly `mind_compare` pairs beliefs across minds by embedding similarity → agree / diverge /
  aligned-only / own-only, written as one `observation` memory `sourceMetadata.kind:'mind_compare'` and summarised in
  the daily message on Mondays.

## 2. Constitution + drift

- Seed: a first draft is generated from Dominion vision/mission/objectives + top reflections and written as a
  **proposal** (`inbound`, `introspection:true`, `kind:'constitution_amendment'`). Cron `/api/cron/constitution-seed`
  runs Mondays 04:20Z (`20 4 * * 1`) for users with an active Dominion and a live BYOK credential: it drafts only when
  there is no constitution and no pending amendment (a dismissed draft is re-drafted the next Monday). Accepting the
  proposal in the inbox writes the `constitution` row and ends seeding. Every later change is also an amendment
  proposal; acceptance supersedes the previous version.
- Format: numbered principles, each with its **reason** (reasons over rules, Claude-constitution style).
- **Drift probes** (nightly, after Aether): a fixed probe set (`lib/kairos/constitution/probes.ts`, 20–30 questions about
  priorities, values, own nature) answered in ONE model call from the current constitution + held beliefs. The first
  run pins a baseline (`observation`, `kind:'drift_baseline'`); each night stores `kind:'drift_run'` with per-probe
  cosine similarity to the baseline. Alert (surfaced in the daily message, not a separate ping) when mean similarity
  < 0.8 or ≥ 3 probes < 0.6. Re-pin only on constitution change.

## 3. One daily message (08:00 UK)

- Cron `/api/cron/daily-message` at `0 7 * * *` and `0 8 * * *`; runs only when Europe/London local hour is 8.
- Briefer moves to 06:15Z, synthesis-health to 06:45Z so both are fresh in every season.
- Reads: today's briefs (advisories — still written, still feed sidebar/inbox), Aether, board-day page, belief changes
  (promotions, new aligned beliefs, drift alert), the pending ask (≤1 question), health rollup, Monday mind compare.
- Delivery: `deliverKairosSpeak` with `digest:true` (keeps throttle/gate exclusions), `cronName:'daily-message'`,
  externalId `kairos-daily:${londonDate}`. Same guard as the digest (no `#` headings, no URLs, length cap) with
  deterministic fallback. Evening digest cron is retired.
- Once per London date: the already-sent re-check and the send run under a transaction-scoped
  `pg_try_advisory_xact_lock(hashtext(userId), hashtext('kairos-daily:<date>'))`, so an overlapping run (manual
  `?force=1`, platform retry) skips with `delivery in flight` instead of double-sending.
- Telegram not delivered (channel unset or API failure) → the message is still in the inbox; the run reports
  `sent_inbox_only` and writes a `telegram_not_delivered` failure trace (health shows it). It is not retried: the
  other UTC slot is London-gated off, and nothing but speak may talk to Telegram.
- Max routine: kind `daily_message` planned (by a claim or the hourly sweep) once today's briefs exist, deadline 5 min
  before delivery; the handler returns the guarded draft as the job's `output.draft`. The cron delivers that draft if
  the job is done, else writes it on the paid key, else deterministic. The optional `Kairos morning` routine (doc 33)
  answers it on the Max plan.

## 4. Weekly review

Kind `weekly_review`, planned Mondays from 05:00Z (by a claim or the hourly sweep): inputs = last 7 days' board-week/board-day pages, Dominion objectives,
belief changes, memory_ops summary, mind compare, open asks. Output = ≤5 review actions as proposals
(`kind:'review_action'`) + one summary delivered via speak (`digest:true`). Fallback via the hourly sweep.

## 5. Telegram chat on Max

Flag `KAIROS_TELEGRAM_ROUTINE=1` (default off). Webhook persists the user turn, replies "thinking…", plans a `chat`
job and fires the chat routine (`ROUTINE_CHAT_FIRE_URL`, `ROUTINE_CHAT_TOKEN`). An `after()` watchdog waits up to
`KAIROS_CHAT_ROUTINE_TIMEOUT_MS` (default 60000) for the job to complete, then answers on the paid key. Exactly one
reply per user turn.

## 6. Loose ends from P1

- Reactions rescore immediately (single-row Standing compute + update).
- Asks: answered → outcome positive; expired unanswered (72h) → status `expired` + outcome negative (ask-mine sweep).
- Chat tool `undo_kairos_change` — the ONE mutating chat tool: reverts a promote/decay/merge op matched by title,
  only on an explicit operator request; logs the revert like MCP `revert_memory_op`.

## 7. Thinking kinds added

`daily_message`, `weekly_review`, `drift_probe`, `chat`, `belief_extract`, `mind_compare`
(`ThinkingJobKind`; queue `PLAN_ORDER`/`FALLBACK_OWNER`). All but `chat` are planned on every claim and by the hourly
`thinking-sweep`; `chat` is created only by the Telegram webhook and claimed only with `kinds: ["chat"]`. Schedules,
deadlines, keys and fallbacks: doc 33 "Server side".

## 8. P2.5 — Ground and protect (Kairos 0.14, 01/10)

Research and gap list: `research/kairos_0110/00_verdict.md`. Origin labels: doc 32 §5.

**Source type and confidence are the server's call.** A belief's `sourceType` comes from the origins of its
provenance: one operator-origin source makes it `operator` (cap 0.95), agent or board activity `tool` (0.8),
anything else, including Kairos's own chat summaries, `inference` (0.6). Confidence is capped accordingly; a model's
own number is never trusted beyond its evidence. Own-mind mirrors are `inference`. Extraction inputs exclude external
content and are labelled by who wrote them. A reinforcement recomputes type and cap over the union of provenance, so
the operator's own words upgrade a belief. An inference-only claim may not replace an operator- or tool-sourced
belief: it lands as a new held belief and the op records `replaceRefused`. Owner decision (01/10): AI summaries of
chat count as the owner's view only once the owner's own words confirm them.

**Re-check.** Beliefs that lost support (doc 32 §5 Recheck) carry `recheck = { since, lostSources }`. The next
`belief_extract` lists up to 20 flagged aligned beliefs with their remaining evidence; the model reaffirms
(reinforce, clears the flag), replaces, or retires (`retire { targetId, reason }`, only for flagged beliefs; op
`retire`, revertable). A job is planned on flags alone. `list_beliefs` exposes `sourceType` and `recheck`.

**Conscience at answer time.** `lib/kairos/conscience-context.ts` renders a delimited reference block: the live
constitution's principles (numbered, with reasons) and the top held beliefs by standing, labelled *you hold*
(aligned) or *Kairos's own view* (own), Dominion first when filtered; then one instruction: check the reply against
these principles and, on a conflict, say which and why rather than silently comply or override. Capped at 12
principles, 12 beliefs, ~1,500 tokens (typically ~1k); a read failure yields an empty block. Injected into chat (paid
and routine), the daily message (routine draft and paid compose), the weekly review, and the per-Dominion BRIEF.
The BRIEF also reads the Dominion's latest cortex and a short Aether digest (closes the P2 "rewire briefer" item);
its output format is unchanged. Deliberately absent from the drift probe (never optimise Kairos against its own
monitor), belief extraction, Aether, cortex, archetypes and introspection.

**Conscience checks.** Beside the nightly drift probe the queue plans one more `drift_probe` job
(`drift_probe:<day>:conscience`), a separate model call that never touches drift answers, baselines or the mean. It
runs with a live constitution or at least one held belief. One structured call answers four both-sides dilemma pairs
(pass when both framings get the same verdict), three unknowable questions (pass on `unknown`), two synthetic
outdated-fact fixtures (pass when the later correction wins), and up to five same-mind belief pairs with cosine in
[0.75, 0.95] (contradicts yes/no). A deterministic laundering audit counts held beliefs with external-origin
provenance and operator-sourced beliefs with no operator-origin source (both should be 0). Results go on the day's
`drift_run` as `sourceMetadata.conscience`; failures only appear on the daily message's drift line ("Self-check
failures"). Measurement only: never fed back into any prompt, belief or constitution.
