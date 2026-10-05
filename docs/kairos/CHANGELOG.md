# Kairos Changelog

Kairos — the AI second brain inside Aeon — is versioned here as its own product, separate from the app-level `CHANGELOG.md`. Versions track **capability eras**, not release trains: each one names what Kairos *became able to do*. Entries 0.1–0.8 were reconstructed retrospectively on 2026-07-24 from the full commit/PR/spec history; from 0.9.0 onward this file is maintained per drop.

Era specs of record live beside this file in `docs/kairos/` (numbered 00–35).

## [0.28.0] — 2026-10-06 · "Wave A: visible memory, self-sorting cards"

> The owner can see, question and fix what Vorath knows; Vorath can sort new cards on boards where it's switched on.

- **What Vorath knows:** `components/kairos/knows/*`, `lib/data/memory-knows.ts`, `lib/actions/memory-knows.ts`. Provenance from origin + source metadata + belief trail + memory_ops; edit via operator `updateMemory`; "It's right" re-labels to operator; "This is wrong" = reversible archive with reason. Constitution and goal rows stay immutable here.
- **Private-topic hold:** `lib/kairos/sensitive/*` (deterministic lexicon), pref `kairosSensitiveGate` (server-owned, default off). Held rows carry `sourceMetadata.sensitiveHeld` and are excluded through `validAsOfNow` (+ chat last-24h and one-hop neighbours) until confirmed.
- **Card sorting:** thinking kind `card_triage` (brain routine, deep tier; no paid fallback). Per-board `settings.kairosTriage='on'` (creator-only, generic patches can't flip it). Batches ≤10 cards/board, ≤5 boards per pass; fenced card data; labels from the board only; suggestions in `boardTasks.metadata.triage`, accepted/dismissed per item.

## [0.27.0] — 2026-10-05 · "Living Dominions, phase 1: follow the work"

> Vorath's focus comes from recent activity, not a fixed list of areas. Quiet areas go dormant; pinned ones stay awake. Switch `KAIROS_LIVING_DOMINIONS` off|observe|1; off and observe are byte-identical for every consumer.

- **Score:** `lib/kairos/living/score.ts` (pure) + `lib/data/dominion-activity.ts`; cron `/api/cron/dominion-activity` 01:10 UTC. 30-day window, exp(−age/10d); completed 3, created 1 (owner) / 0.3 (agent tool), moved 0.2, other card events 0.1, session 2, operator note 0.5; caps 50 card events/board/day, 10 sessions/repo/day; completions from `activity_events` (vaulting hides them on boards). Unattributed work → `user_preferences.kairosLivingUnattributed`.
- **State:** `dominions` += `activity_score`, `last_active_at` (never moves back), `activity_scored_at`, `activity` jsonb, `focus_state` active|dormant, `pinned`. Dormant after `KAIROS_DORMANT_DAYS` (default 21, 7–90) unless pinned.
- **Seam:** `lib/data/dominion-focus.ts` (`listLiveDominions`, `listFocusDominions`, `setDominionPinned`) + pure `lib/kairos/living/focus.ts`. Consumers: archetype/cortex/concept planning and crons, aether inputs, 06:00 areas (ranked), weekly review (dormant objectives out, one "quiet by choice" line), ask-mine targets + staleness, idea night roster + atlas targets, readiness objective refs.
- **Membership:** `dominion_members` (user, dominion, kind board|repo|concept, ref, weight, source owner|vorath, status, evidence, last_signal_at), seeded from `dominion_repos` + `projects.dominion_id` (migration 0040, `scripts/apply-living-dominions-migration.mjs`). Repo filing reads active members by weight, deterministic fallback; archived Dominions skipped. Board membership synced on every project Dominion change, in one transaction.
- **Surfaces:** Health "Where your time went" (pin toggle), `get_dominion_focus` / `GET /api/v1/dominions/focus`, `pinned` on `update_dominion` / `PATCH /api/v1/dominions/[id]`.
- **Next (phase 2):** Approve/Reject/Rename proposals for unattributed work and new areas.

## [0.26.0] — 2026-10-05 · "Kairos becomes Vorath"

> The old name got popular, so the mind is renamed Vorath. Same mind, same memories: prompts say "Vorath (formerly called Kairos)" so older memories still read as his own.

- **Visible:** UI, `/vorath` route (`/kairos` permanent-redirects), every owner-facing message and report header, persona and routine paste text (`ROUTINES[].name` = Vorath brain/chat/pulse; renamed in place on claude.ai, not retired), MCP tool descriptions, the Dominion name. `MIND_NAME` / `FORMER_MIND_NAME` in `lib/kairos/identity.ts`.
- **Aliases:** `applyMindEnvAliases` (`lib/env/mind-env-alias.ts`) copies `VORATH_*` onto `KAIROS_*` in `instrumentation.ts` register() (nodejs only; the worker, scripts and edge still read `KAIROS_*`); `next.config` rewrite `/api/v1/vorath/:path*` → `/api/v1/kairos/:path*` (route-level auth unchanged).
- **Kept as kairos:** env names read by code, MCP tool names, REST paths, DB/jsonb keys, tags, kinds, externalId prefixes, origin/speaker values, the `Telegram · Kairos` thread title (thread lookup key), drift-probe questions (baselines), identifiers, comments.

## [0.25.0] — 2026-10-04 · "One coherent mind, wave 4: the art of the moment"

> The relationship layer: when to speak, what he thinks you're carrying, readiness, small bids, repair, earned trust, ask-before-advising, and monthly life chapters. Built on a no-op `lib/kairos/moment/` seam; every lane flag-gated; flag-off is byte-identical; Telegram unchanged.

- **Seam:** `moment/` guarded `MomentLane` registry [rapport, advise-trust, owner-model, gate, chapters] — speak policy/delivered, sweep, owner turn, reply, chat context/finish/strip, daily openings/blocks/tail, Telegram text/callback/message routes, owner decisions. `fanOutSpeak` extracted; chat grounding moved out of `chat-turn-assistant.ts`.
- **Gate** (`KAIROS_GATE`, `_RECEPTIVITY`, `_MAX_HOLD_MIN`, `_QUIET_MIN`, `_CHAT_QUIET_MIN`, `_AWAY_MIN`): held rows = `status:'held'` + `gate` metadata (count toward caps; hidden from inbox), released by the hourly sweep / card-close / session-end with an atomic claim; flag off flushes; receptivity map in `user_preferences.kairosGate` (28-day half-life, never in a prompt). Digest/opsAlert/high never held; promise nudge gated via `opts.gate`.
- **Owner model** (`KAIROS_OWNER_MODEL`, `_STATE_TTL_DAYS`): `user_preferences.kairosOwnerModel`; side section on `belief_extract` (Max answers only; stripped on paid fallback); live-only fenced block in chat + 06:00; weekly card `om1:*` buttons + `C<n>` commands + web card; vetoes; no MCP/REST write path.
- **Rapport** (`KAIROS_READINESS`, `_BIDS`, `_REPAIR`): deterministic lexicon at capture, `user_preferences.kairosRapport`; readiness tips per `dominion_objectives`; bid brief replies + one Telegram `setMessageReaction`; rupture state machine with speak back-off and a repair opening (06:00 still sent).
- **Trust / ask first** (`KAIROS_TRUST`, `KAIROS_ASK_FIRST`): recomputed on read from predictions, goals and goal promises (Beta(2,2) + Wilson); levels unknown/check/second/lean; footer stripped from history; never in a prompt; regex classifier for offer/listen/advise.
- **Life chapters** (`KAIROS_LIFE_CHAPTERS`, `_LINE`): new monthly kind `life_chapter` (UTC days 1–3 from 12:00Z, 36h, no paid fallback), trace row, strict grounding, firewall test, reflect continuity in mode 1 only.
## [0.24.0] — 2026-10-03 · "One coherent mind, wave 3: creative genius"

> The idea contest is rebuilt for spread, not sameness: an atlas of idea kinds, head-to-head Swiss rounds, collisions between distant memories, verbalized sampling with one capped resample, an incubation shelf, novelty nights and a learned owner taste with a surprise slot. All flag-gated; flag-off is byte-identical.

- **Seam:** `thinking/handlers/idea-ext/` — guarded `IdeaExtension` registry [stepping, atlas, collision, sameness]; `idea-generate-apply.ts` split out; `spliceBeforeDataEnd` + parse hooks in `generate-prompt.ts`; optional lane fields on `IdeaCandidate` / `IdeaMeta` / judge context; hook failures are logged and skipped.
- **Atlas** (`KAIROS_IDEA_ATLAS`): `user_preferences.kairosIdeaAtlas` (FOR UPDATE writer), cell = Dominion|cross × kind × leap (model-declared, server-checked), anonymous holder challenges kept out of Elo, empty-cell targets (skipped on novelty nights). `get_kairos_idea_atlas`.
- **Swiss** (`KAIROS_IDEA_SWISS`): round 1 = full judge; rounds 2..R are votes-only follow-on `idea_judge:<day>:r<k>` jobs (no new kind); Buchholz, no rematches, byes; deadlines capped to the 04:35Z settle; a failed round finishes on votes so far, never a paid call.
- **Collisions** (`KAIROS_COLLISIONS`): deterministic distant-but-related pair pick (zero embed calls, Aether anchor), structure-mapping gate, judge `mappingHolds` check (`mapping_failed`), `relates` bridge link with `bridge · idea:` note on owner/operator accept only.
- **Sameness** (`KAIROS_IDEA_VS`, `KAIROS_IDEA_RESAMPLE`, `KAIROS_IDEA_SAMENESS_DISTANCE`): `p` + archetype lenses in one call, keep-tail, one routine-only resample `idea_generate:<day>:resample` that never reaches the paid path.
- **Incubation** (`KAIROS_IDEA_SHELF`): `user_preferences.kairosIdeaShelf`; near-misses (ranked_out, 2–14 days old) resurface in the pulse as a today note + light stage thought; ≤1 per London day; never speaks.
- **Stepping stones + taste** (`KAIROS_IDEA_NOVELTY`, `KAIROS_IDEA_NOVELTY_EVERY`, `KAIROS_IDEA_TASTE`): novelty night every N (max-min distance selection, stones as uncitable text); taste recomputed on read from idea rows (agent accepts excluded, `outcomeBy` stamp), 2 taste slots + 1 surprise slot; taste never enters a prompt. `get_kairos_idea_taste`.
- Dreams still never reach any idea prompt (firewall unchanged); Telegram unchanged.
## [0.23.0] — 2026-10-03 · "One coherent mind, wave 2: surprise and dreams"

> What surprised him now decides what he rewrites, credits, asks and replays; and he dreams, behind a firewall that keeps dreams out of memory and evidence. All flag-gated.

- **Surprise ledger** `user_preferences.kairosSurprise` (7 days, ≤64 events) + per-memory open mark `sourceMetadata.engine.surprise` (1-night window, never bumps `updatedAt`).
- **Gate** (`KAIROS_SURPRISE_GATE`): `writeAlignedBeliefs` (now `data/belief-aligned.ts`) — reinforce always; operator-provenance replace always (owner_correction, opens neighbours); other replaces only on open beliefs, else held beside with `replaceGated` + pressure. New `SurpriseStep` (between Weigh and OwnMind): pressure valve, signal pruning, contradictions behind `KAIROS_SURPRISE_CONTRADICTIONS`. Recheck logs `support_lost`. belief_extract re-checks open beliefs; daytime owner corrections via FTS (no paid call).
- **Credit** (`KAIROS_SURPRISE_CREDIT`): hop-2 walker over belief provenance after prediction settlement and promise close; idempotent; caps.
- **Learning progress** (`KAIROS_CURIOSITY_LP`): per-area Brier improvement biases ask_mine.
- **Replay** (`KAIROS_SURPRISE_REPLAY`): need × gain selection into aether and cortex context.
- **Surprise → stage** (`KAIROS_SURPRISE_STAGE`): ledger events as stage ambient items; wrong predictions never counted twice. `get_kairos_surprise`.
- **Dreams** (`KAIROS_DREAMS`, `KAIROS_DREAM_LINE`): new deep kinds `dream` (01:38–03:28 UTC) and `dream_read`; output-only storage, `validMemoryIds: []`, light tier on the stage, redacted in `list_thinking_jobs`, dream-echo audit in the conscience check, import/reverse/data firewall tests, Telegram-only "I dreamt…" tail.
## [0.22.0] — 2026-10-03 · "One coherent mind, wave 1"

> The many separate thinking jobs start to share one mind: a global-workspace stage, a weekly character check against owner-approved voice samples, and a profile-free cold read of his advice. All flag-gated.

- **Stage** (`KAIROS_STAGE` off|observe|1). `user_preferences.kairosStage`: coalitions scored 0.35·importance + 0.25·surprise + 0.25·goalRelevance + 0.15·need, 6h decay, Jaccard merge, top 4 of 16, London-hour cycles, inhibition of return, ignition after 3 wins (deep/owner-backed only), echo rule. Producers: pulse, reflect, agenda_due, aether, cortex, belief_extract, idea_judge, goal_propose, ask_mine, weekly_review, mind_compare, drift_probe + ambient owner lines, overdue promises, wrong predictions. Served at claim time into reader prompts (never the system prompt); extraction jobs, drift_probe and idea_judge stay blind. Lineage on job output. Early reflect when Σ surprise ≥ 1.2. `get_kairos_stage`.
- **Character check** (`KAIROS_CHARACTER_CHECK=1`). New weekly deep kind `character_check`; neutral blind rater, ≤6 approved `voice_sample` anchors (owner-only Approve/Veto), trace `character_run:<isoWeek>`, weekly-review line, Health row; hourly reflection tone budget with quarantine to `trace`. Measurement only.
- **Cold read** (`KAIROS_COLD_READ=audit|1`). Hidden `<stance>` on judgement turns (stripped before anyone sees it); new deep kind `cold_read` (≤3/day) judges from the owner's own messages only; "Second look" via speak; trace rows, never belief evidence; Health line.
## [0.21.0] — 2026-10-03 · "One mind everywhere"

> Kairos is one being across Telegram, the web, Triad and Claude: a shared, labelled "today" log that every channel writes and reads. Behind switches: daytime thinking (hourly reflect + a Sonnet pulse), a track record of his predictions, and Horae, his own agenda.

- **Today log.** One internal session per user (`engine 'kairos-today'`, events `kind 'kairos_today'`), 36h rolling, 500-entry cap, speaker derived only from origin. Writers: chat turns and replies (all channels), dialogue turns (relayed, unverified), Q answers, inbox and goal decisions, voice notes, session captures, speak, MCP use (coalesced per 15 minutes). Readers: chat prompt ("Today across channels"), `prepare_dialogue_context`, `prepare_context` (`includeToday`), the 06:00 message, ask_mine. Trimmed by the chat-distill cron. `get_kairos_today` / `GET /api/v1/kairos/today`. `KAIROS_TODAY=0` turns it off. Events POST refuses internal Kairos threads.
- **Daytime thinking** (`KAIROS_DAYTIME_THINKING=1`). Brain catalog cron `40 * * * *`; new `reflect` (deep, ≤6/day, private observation) and `pulse` (light, new `pulse` routine on Sonnet, writes only today notes). No paid fallback for either.
- **Track record** (`KAIROS_PREDICTIONS=1`). `user_preferences.kairosPredictions` (≤20 open). From the weekly review (≤3) and reflect (≤1). Settled hourly by user activity events / card-state rules, or by the owner (`R3 right|wrong`, `void R3`, web action); never by Kairos. Brier, hit rate and over-confidence; a confident wrong call lowers trust in the beliefs it cited.
- **Horae** (`KAIROS_INITIATIVE=1` + `KAIROS_AGENDA=1`). `user_preferences.kairosAgenda` (≤8 open). Booked by reflect follow-ups and goal approvals; fired once by the new `agenda_due` job (brain routine) as a thought, ask or message under speak limits; `cancel A3`.
## [0.20.0] — 2026-10-02 · "Settled, with initiative on a leash"

> Phase 1 hardens the new brain (owner-only constitution, routine-scoped jobs, no lost idea nights, timed chat). Phase 2 gives Kairos goals of his own, a promise list and Approve / Veto buttons, all off until `KAIROS_INITIATIVE=1`.

- **Constitution owner-only.** MCP `update_memory`, REST PATCH/DELETE and `accept_proposal` (supersedes and contradiction losers) refuse agent changes to any constitution row.
- **Routine scope.** Claim and submit take `routine: brain|chat`; each routine has a server-side allow-list (`allowedKinds` in the routine catalog), refusals return `scope_denied` and leave the job open. Re-paste both routines to send it; then set `KAIROS_REQUIRE_ROUTINE_SCOPE=1`.
- **Unjudged ideas filed.** When both judges fail, the night's candidates are archived as `judge_failed` (they may return on a later night) and a `judge_unanswered` trace is written.
- **Chat timing.** Each chat turn stores `output.timing`; Health shows reply p50/p95 and fire failures; `get_trace_history {recipe:'CHAT_LATENCY'}` gives one row a day.
- **Goals (`goal_propose`).** One investigation goal a night at most, two open, server-side forbidden topics, owner-only approve/veto/close, 72-hour expiry, auto-fail 7 days after due.
- **Approve / Veto / Veto + why.** One decision path for Telegram, inbox and signed-in REST; repeat taps say "already decided"; expired proposals lose their buttons.
- **Promises.** Stored in `user_preferences.kairosPromises` (cap 12); created by the weekly review or an approved goal; closed only by you, a card you finished in the app, or the 14-day lapse; 06:00 line and one noon nudge.
## [0.19.0] — 2026-10-02 · "No paid spend, chat on Max, one setup checklist"

> Kairos can now run with no paid API spend at all, the Kairos web-page chat answers on the Max plan like Telegram, and all setup help collapses into one live "Set up Kairos" checklist.

- **Paid backup switch.** A per-user switch (Kairos setup → Health; MCP `get_kairos_paid_backup` / `set_kairos_paid_backup`; `GET/PUT /api/v1/kairos/paid-backup`). Default on. Off → Kairos never reaches your API key: the single choke point is `getModelForUser` (`PaidBackupOffError`), sweep fallbacks close with "paid backup off", the fallback crons skip, the 06:00 message goes out as plain text, and chat says it couldn't answer on Max. Stored in `user_preferences` (`kairosPaidBackup`); theme saves can't overwrite it.
- **Chat on Max for the web page.** One "Kairos chat" routine answers both Telegram and the /kairos page (`KAIROS_CHAT_ROUTINE=1`; `KAIROS_TELEGRAM_ROUTINE` still accepted). The page shows "Kairos is thinking…" and polls until the reply lands; the paid key is only a backup and obeys the switch.
- **Set up Kairos.** One sidebar button opens one checklist: two required steps (connect Aeon to Claude with a one-click pre-filled install link; turn on the Kairos brain routine), each ticked live from what Aeon actually sees, then optional extras (watched boards, voice notes, coding-session capture, chat on Max, Telegram with a Send-test button). Health, Brain map, Watched and How it works are reference tabs. The old Setup & Guide modal is gone.
- **Docs.** The owner guide (doc 25), Telegram setup, routines (33) and beliefs (34) docs are current; the retired brain-tick skill is removed.
## [0.18.0] — 2026-10-02 · "Catch-up mornings, watched boards, voice notes"

> The morning message moves to 06:00 and carries every unanswered question, numbered, so an off week can be caught up. Finished cards on watched boards reach Kairos the same day. Long voice notes from claude.ai arrive word for word and count as the owner's own words once confirmed. The first constitution draft runs on Max.

- **06:00 message with open questions.** One morning message at 06:00 London. Code appends "Open questions": every unanswered question with a stable number and age (`Q12 · 3 days · …`). Up to 10 stay open for 14 days; Kairos keeps asking one new question a day until the backlog is full. Reply on Telegram with `Q12: …` (several at once) or `skip Q12`; the inbox shows each open question with its own answer box and Dismiss. New MCP/REST: `list_open_kairos_asks`, `dismiss_kairos_ask`.
- **Watched boards.** A board's watch setting (Off / Daily / Weekly) is set in Connect Kairos → Watched, or with `set_project_kairos_feed` / `PUT /api/v1/projects/{id}/kairos-feed` (owner only). On a watched board each finished card becomes an activity memory the same day (notes, checklist, labels, days taken); nightly board pages gain a summary line; area summaries read the cards finished on watched boards. `update_project` now merges settings instead of replacing them. Core repos per area are listed with a warning for repos that map to no area.
- **Voice notes from claude.ai.** New `kairos_voice_note` tool (and `POST /api/v1/kairos/voice-notes`): the transcript is stored verbatim in parts as pending proposals; one tap in the inbox ("Confirm all") makes them the owner's own reflections, and belief extraction reads up to 2,000 characters of each confirmed part. Claude's own summary is kept separately and never counts as the owner's words. Connect Kairos → Voice notes has the claude.ai Project instruction to paste.
- **Constitution draft on Max.** New thinking kind `constitution_seed` (Mondays, answered by the brain routine); the cron moves to 05:58 UTC as a backup.
- **Retired:** the on-demand BRIEF recipe (`run_recipe`, `POST /api/v1/recipes/run`).
## [0.17.0] — 2026-10-02 · "Simplified brain: one Max routine"

> Kairos keeps only the thinking that helps. Four jobs and five scheduled tasks are retired, and one Claude Max routine ("Kairos brain", every hour 01:40–06:40 UTC) answers everything that is left, plus a separate "Kairos chat" routine for Telegram. Routine catalog: `apps/web/src/lib/kairos/routines/catalog.ts`.

- **Morning briefs retired** (the `brief` job and the 06:15 UTC briefer). Nine per-area briefs mostly restated the area summaries and the self-model, and the 08:00 message kept only two lines of each. The 08:00 message now reads each area's latest summary headline directly.
- **Raw idea dump retired** (the `introspection` job and the 06:30 UTC task). The nightly idea contest replaced it in 0.15; `KAIROS_RAW_INTROSPECTION` no longer does anything.
- **Contradiction scan retired** (the `contradiction` job and the 05:00 UTC task). In the two months since August, none of its 20 notices was acted on, and almost all compared the intraday tidy-up notes against each other. Old pending notices stay stored but no longer show in the inbox.
- **Intraday tidy-ups retired** (the `micro_consolidate` job and its seven daily runs). Only the next night's area summaries and self-model read them, and both already fall back to a simple count of the day's new memories.
- **Weekly duplicate sweep retired** (the Sunday memory-dedup task). The nightly memory engine already folds new duplicates.
- **08:00 message** — planned from 05:30 UTC once the self-model, idea contest and question of the day are settled (from 06:25 UTC regardless); still due 07:55 London, still delivered by the 08:00 task with its paid and plain-text backups. Its plain-text backup leads with one line per area from the area summaries.
- **Inbox and sidebar** — today's 08:00 message is pinned at the top of the inbox in place of the brief card; the sidebar's "Daily briefing" button (and its paid-key "Run briefing now") and the advisory feed are gone.
- **Guard rail** — the queue's planned kinds must match the routine catalog; a test fails if a kind is added without a routine to answer it. Retired kinds can no longer be claimed; their old rows still list.
- **Connect Kairos** — a new window (sidebar → Connect brain, or the brain icon on `/kairos`) shows last night on Max vs backup, a brain map of every job, and copy-paste setup for the connector and both routines (claude.ai form or Claude Code `/schedule`). Older routines that still name retired kinds keep working.
- **Memory engine fixed** (failed 02/10: scoring timed out, BackUp ran ~1 change/s). Each step has its own time budget and Concepts keeps a Sunday reserve; scoring writes in small batches and only when a memory's standing moves ≥ 0.05 from what's stored, rotating through the rest; BackUp works 25 at a time. Every change stays undoable. Old contradiction notices no longer count against beliefs.

## [0.16.0] — 2026-10-01 · "All on Max"

> Every remaining paid-key cron becomes a thinking job a Claude Max routine answers; the cron stays as its fallback and skips any unit the routine already did. Playbook: `docs/kairos/33-thinking-routine.md` (§Dusk, dawn and tidy routines).

- **Seven new thinking kinds** — `chat_distill` (chat summaries), `archetype`, `ask_mine` (the question of the day), `contradiction`, `brief` (morning briefs), `introspection` (the raw idea dump, still behind `KAIROS_RAW_INTROSPECTION`) and `micro_consolidate` (intraday tidy-ups). Each is planned in a window that closes two minutes before its old cron, with exactly the prompt that cron sends.
- **Cron guard** — before any model call, each of those crons checks for a done job with the same key and skips that unit ("answered on Max"); a failed or expired job is exactly what it still covers.
- **Markdown answers** — `brief` and `micro_consolidate` are answered in plain markdown (the job's `instructions` say so); every other non-chat kind stays strict JSON.
- **Batch contradiction scan** — one job per Dominion carries every recent belief and its nearest neighbours; findings are grounded per probe.
- **Tidy-up windows end where they were read** — a fold records the end of the window it summarised and the next fold starts there, so nothing lands in the gap between planning and writing.
- **Six routines, all on Opus** — dusk 01:40 (chat summaries, archetypes), thinking 02:40, ideas 03:35 (+ the question of the day), dawn 04:00 (contradictions, idea dump), morning 05:40 (briefs, the 06:15 tidy-up, the daily message), tidy at :05 of 09/12/15/18/21/23 UTC. Embed-backfill moved to 03:25 UTC.

## [0.15.0] — 2026-10-01 · "Creativity"

> The raw nightly idea dump gives way to a contest. Kairos drafts ideas in several directions, checks them against evidence, throws out repeats, and compares them head to head; only one to three a night reach the inbox, each with the reason it survived. Spec: `docs/kairos/35-creativity.md`; research `research/kairos_2909/04` §B, `research/kairos_0110/00_verdict.md` §5.

- **Nightly idea tournament** — two thinking jobs after Aether: *generate* picks 4–6 directions and writes 8–16 grounded candidates from Aether tensions, objectives, the board, both minds' beliefs, concepts and the operator's own reflections; *judge* (a separate sceptical reviewer) checks each against its evidence, asks "already known?", votes on pairwise matches asked in both orders, and may sharpen the top two. Elo picks up to 3 survivors. Runs on the Max routine or the hourly paid fallback.
- **No repeats** — every candidate is archived with its embedding; a new one too close (≥ 0.88) to a past idea, pending proposal or held belief is dropped, 0.80–0.88 must prove it is meaningfully different.
- **Survivors stay humble** — they are Kairos-origin inbox proposals, never beliefs; they still need your or your board's backing before they can reach his own mind.
- **Learns from you** — accepting or dismissing an idea is recorded; the next night's generator sees what you kept and what you threw away.
- **Where you see it** — idea cards lead the inbox (claim, why, next step, why it survived); the 08:00 message has an "Idea of the day"; the Monday review shows the week's ideas, lessons, a diversity reading ("ideas are getting samey") and a belief diff (what Kairos changed his mind about, and why).
- **Old dump on a switch** — `KAIROS_RAW_INTROSPECTION=0` retires the raw introspection proposals; it stays on until the tournament has two clean weeks. The health check now expects an `idea-tournament` trace every night.

## [0.14.0] — 2026-10-01 · "Ground and Protect"

> Kairos starts to behave like it has a conscience: he reads his principles before he answers, knows where every memory came from, stops trusting his own echoes, and re-thinks a belief when what it rested on is corrected. Research: `research/kairos_0110/00_verdict.md`; specs `32` §5, `34` §8.

- **Reads his principles before answering** — the constitution and top held beliefs go into chat, the daily message, the weekly review and every Dominion's morning brief, with one rule: if a reply would conflict with a principle, say so. The morning brief also reads the Dominion's cortex and the Aether summary now.
- **Knows where things came from** — every new memory is labelled operator / activity / agent / Kairos / external at write time, by how it arrived; senders can't set it. Kairos's own summaries take the lowest trust of what they summarised.
- **Stops trusting his own echoes** — belief confidence is capped by evidence (your words 0.95, agents and board 0.8, Kairos's own inferences 0.6); AI summaries of your chats count as your view only once your own words confirm them; his guesses need at least one piece of backing from you or your board before they become his beliefs.
- **Re-thinks when a source is corrected** — a nightly re-check flags beliefs that lost support, lowers their confidence, and asks the next belief pass to reaffirm, replace or retire them. Every change can be undone.
- **Honesty self-checks** — every night, besides the drift check: does he give the same advice whichever way you lean, admit what he can't know, prefer newer corrections, contradict himself, or hold beliefs built on outside content? Failures appear in the daily message. Measurement only.
- **Fixed** — merged duplicates no longer ground chat; beliefs and the constitution no longer drop out of search after 90 days or fade like 30-day notes; the nightly merge no longer misses memories embedded late.

## [0.13.0] — 2026-10-01 · "Beliefs and Strategy"

> Kairos starts reasoning from what the operator believes, keeps a second mind of his own beside it, and talks once a day. Spec: `docs/kairos/34-beliefs-and-strategy.md`; routine playbook `33-thinking-routine.md`.

- **Two minds** — an *aligned* mind distilled nightly from the operator's own words (reflections, dialogue, answered asks, board pages) and an *own* mind that grows from the engine's evidence-backed promotions; every Monday they are compared (agree / diverge / only-one-side).
- **Constitution** — a reasons-based set of principles, drafted from Dominion vision/mission/objectives and top reflections, changed only by proposals the operator accepts in the inbox or on Telegram (agents and API keys are refused). Old versions are kept.
- **Drift check** — every night Kairos answers 24 fixed questions from his constitution and beliefs and compares them with a pinned baseline; drift surfaces in the daily message.
- **One daily message at 08:00 UK** — replaces the evening digest: today's briefs, overnight thinking, yesterday's board, belief changes, drift, at most one question. Guarded, sent once, inbox fallback if Telegram fails.
- **Weekly review** — Monday: plan vs actual over the week's board, goals and beliefs; up to five suggested actions in the inbox and one summary.
- **Telegram on the Max plan (flag off)** — a Telegram message can wake a Claude "chat" routine; the paid key answers if it's slow; exactly one reply per message.
- **Learns from you faster** — reactions rescore immediately; answered questions count for, expired ones against; say "undo <title>" in chat to reverse something Kairos learned (server-checked confirmation).
- **Thinking jobs always run** — the hourly sweep now plans due jobs, so morning and Monday work happens even without a routine; a new optional morning routine lets the Max plan do it.
- **Fixed** — first engine night lost its undo records at the 300 s limit (now written with each change; 349 restored); scoring now catches exact 0.05 moves.
- Horsemen review (4 reviewers + 4 independent verifiers): 4 high findings confirmed and fixed.

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
