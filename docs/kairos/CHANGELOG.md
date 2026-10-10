# Vorath Changelog

**Owner-only.** Vorath (formerly Kairos) is the owner's private second brain inside Aeon. This log is shown in the app only to the owner (Changelog → Vorath tab) and is never part of the public `CHANGELOG.md` that beta testers see. `npm run changelog:sync` turns it into a server-only module; `changelog:check` fails if Vorath content leaks into the public log.

Versions track **capability eras**, not release trains: each one names what Vorath *became able to do*. Entries 0.1–0.8 were reconstructed retrospectively on 24/07/2026 from the full commit/PR/spec history; from 0.9.0 onward this file is maintained per drop. Everything removed from the public changelog on 10/10/2026 is kept below under "Moved from the app changelog", each block with the app version and date it first shipped in.

Era specs of record live beside this file in `docs/kairos/` (numbered 00–35).

## [0.32.0] — 2026-10-10 · "Total Recall"

> No app release. Lessons read real git, AI DONE logs work nobody wrote down, Triad can close questions, and one honest search core sits behind every way Vorath remembers. PRs #172–#187, 07/10–10/10.

- **Lessons read git (#172–#175):** the `repo_lessons` prompt gets one facts line per captured session and the nightly per-repo git digest (`repo_git_digest` memories posted by `apps/web/scripts/git-stats` from the owner's PC); digest ids are valid citations. git-stats counts all code and attributes AI-made work. Archived boards (#172) leave Vorath's live inputs (cockpit, gardener, triage, handovers, snapshots); captured memories stay searchable.
- **Triad (#177):** `answer_asks_from_message` + `POST /api/v1/kairos/asks/answer-message` relay an owner message through the Telegram Q-label and reply-to parsing (agent origin). `prepare_dialogue_context` searches the whole brain when a dialogue has no Dominion and returns `replyStyle`.
- **Capture (#178, #179):** stale empty Copilot sessions are skipped instead of dead-lettered; Dominion filing reads `repo ?? repoSlug` through `resolveRepo`; autonomous research-loop sessions are guarded out.
- **AI DONE (#179–#181):** per-board, creator-only switch (`kairosAiDone`, on at level 1). Each afternoon (16:00–18:30 London) the `ai_done` job files short owner-style cards for unlogged session work into an AI DONE column right after Done. Any repo with a usable slug counts; up to two of the board's own labels; dedup against 90 days of finished work (Done column, status done, vault).
- **One search core (#183):** `search-core.ts` (FTS + vector RRF, standing, rerank, real-memory filter, optional Dominion scope) now backs chat, `search_memories` and `prepare_context`. Agent reads count as use; new and edited memories embed on write; rerank/embed time out and fall back. Synthesis skips areas with no new input and edits archetypes in place (memory_ops undo). The 06:00 Telegram message is a short brief; the idea of the day gets Keep/Drop buttons; undecided ideas archive as "ignored" after 7 days.
- **Honest search + Sunday deck (#184):** `retrieval.confidence` and `lowConfidence` (below 0.55, set from the 40-question eval); weak hits are flagged, never dropped. `prepare_context` lists query matches before pinned memories. On Sundays the 06:00 run sends one numbered deck (at most 10, oldest first) answered with "1y 2n 3 skip"; the decision journal stays out of it.
- **Vector fix (#185):** `SET LOCAL hnsw.iterative_scan = strict_order` keeps the HNSW scan going past filtered-out machine rows, so those queries no longer come back empty.
- **Eval + graph step 1 (#186, #187):** a 40-, then 100-question retrieval eval (`npm run eval:retrieval`; big-picture set, abstention by confidence). Search widens the rerank pool with link neighbours and archetype signposts; on by default since #187.

## [0.31.0] — 2026-10-07 · "Your judgement"

> A morning cockpit, a decision journal, likely finish dates on cards and a weekly tidy-up. Shipped with app 0.49.0 (PR #170).

- **Cockpit:** `/vorath/cockpit` (`components/kairos/cockpit/*`), `get_kairos_cockpit` / `GET /api/v1/kairos/cockpit`: due items, open questions, promises, waiting proposals, stale cards, overnight agent runs and repos with new lessons, each linked to where the owner acts.
- **Decision journal:** `/vorath/decisions` (`components/kairos/decisions/*`), MCP tools + `/api/v1/kairos/decisions`: expectation, confidence and check date per call; settle in the app or with "D3 right" on Telegram; calibration per type. Agent-logged decisions count only after the owner confirms them.
- **Card forecasts:** `ForecastBadge` + `/api/v1/projects/[id]/forecast` and its MCP tool. Listed in the public changelog as a board feature.
- **Weekly gardener (level 2):** `CardGardenProposal` suggests finish, park, merge or archive for up to 10 cards untouched for three weeks; nothing changes until approved.
- **Fixes:** Telegram reply-to answers only single-question messages and never swallows owner commands; "Q11 my answer" without a colon closes the question; finished missions land in a Landing Zone column; over-long summaries are shortened instead of failing.

## [0.30.0] — 2026-10-06 · "Plan a goal"

> Give Vorath a goal, get a card tree you approve. No card exists before Approve. Shipped with app 0.48.0 (PR #168).

- **Request:** "Plan a goal" on the board header (`PlanGoalDialog`), `request_card_tree` and `POST /api/v1/kairos/card-tree`; proposals in `lib/data/card-tree-proposals.ts`.
- **Draft:** thinking handler `card-tree` (brain routine) grounds in the board's columns and labels (`lib/kairos/card-tree/ground.ts`) and drafts up to 12 cards with order, checklists and labels.
- **Decision:** waits in the inbox (`CardTreeProposal`) and on Telegram through the proposal gate. Approve creates the cards and their dependencies in one go and lays them out with `lib/schedule/solve-project.ts`; Veto, or 7 days without an answer, creates nothing.

## [0.29.0] — 2026-10-06 · "Running the workforce, wave 1"

> Vorath starts managing the agent workforce: lessons and handovers per repo, a payback ledger for missions, and an advisory check on finished missions. Shipped with app 0.47.0 (PR #167).

- **Repo lessons:** the nightly `repo-lessons` handler reads the day's agent sessions and keeps one lessons note per repo (what worked, what broke, traps), each lesson citing its sessions (`lib/kairos/repo-memory/*`, `lib/data/repo-memory.ts`). On at level 1.
- **Handover:** `get_repo_handover` / `GET /api/v1/kairos/repo-handover`, built fresh from recent sessions, the repo's open cards, open questions and promises, and the lessons (`lib/data/repo-handover.ts`). A board label or a folder name resolves the repo (`repo-memory/aliases.ts`).
- **Payback ledger:** `lib/data/payback.ts`, `PaybackPanel` on the Velocity tab, `get_agent_payback` / `GET /api/v1/hangar/payback`: missions run, finished, failed and stalled, known cost, cost per finished mission, most expensive cards.
- **Mission check (advisory):** thinking kind `mission-check` compares a finished mission's report with the card's description and checklist and leaves a verdict on the card. Per-board creator switch (`MissionCheckToggle`); boards the user can no longer edit are skipped. It never moves, closes or merges anything.

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

---

## Moved from the app changelog

On 10/10/2026 every Vorath, Dominion, memory, Telegram, thinking and Hangar/AI-mission item was taken out of the public `CHANGELOG.md`. The text below is exactly what the app changelog said, grouped by the app version and date it shipped in. Sections marked "split" were mixed: their board, realm, auth and connector bullets stayed public and only the lines here moved. App releases left empty read "Internal improvements." in the public log.

### From app 0.49.0, 07/10/2026

> Areas touched: `KAIROS` `BOARD` `MCP` `API` `UI`
> Theme: your judgement — a morning cockpit, a decision journal, likely finish dates on cards, and a weekly tidy-up.

#### Added — Morning cockpit · `KAIROS` `UI` `MCP` `API`
- Vorath → Cockpit: one screen with what's due, open questions, promises, proposals waiting for you, stale cards, what agents ran overnight and which repos got new lessons. Every line links to where you act on it.

#### Added — Decision journal · `KAIROS` `UI` `MCP` `API`
- Vorath → Decisions: log a big non-trading call with what you expect, how sure you are and when to check. Settle it in the app or with "D3 right" on Telegram; see how your calls land per type. Agents can log for you, but nothing counts until you confirm it.

#### Added — Weekly tidy-up (level 2) · `KAIROS` `BOARD`
- Once a week Vorath suggests finish, park, merge or archive for up to 10 cards nobody touched in three weeks. Nothing changes until you approve; merge only points you to the board.

#### Fixed · `KAIROS` `BOARD` — split: public bullets stayed in the app changelog
- Telegram answers like "Q11 my answer" (no colon) and replies to a question now close Vorath's questions.
- Finished missions now land in a "Landing Zone" column; missions you stop yourself show as "stopped by you" in payback.
- Fewer failed nights: over-long summaries are shortened instead of failing, and long question titles no longer crash the nightly question.

### From app 0.48.0, 06/10/2026

> Areas touched: `KAIROS` `BOARD` `MCP` `API` `UI`
> Theme: give Vorath a goal, get a plan you approve.

#### Added — Plan a goal with Vorath · `KAIROS` `BOARD` `MCP` `API`
- "Plan a goal" on the board header (also `request_card_tree` for agents and a REST route). Vorath drafts up to 12 cards with their order, checklists and the board's own labels on his next run.
- The draft waits in the Vorath inbox and on Telegram. **No card exists until you press Approve.** Approve creates the cards and their dependencies in one go and lays them out on the timeline; Veto, or no answer within 7 days, creates nothing.

### From app 0.47.0, 06/10/2026

> Areas touched: `KAIROS` `BOARD` `MCP` `API` `UI`
> Theme: Vorath starts running the workforce — lessons and handovers per repo, what agent work costs, and a second opinion on finished missions.

#### Added — Repo lessons and handovers · `KAIROS` `MCP` `API`
- Every night Vorath reads the day's agent sessions and keeps a short lessons note per repo (what worked, what broke, traps), each lesson pointing to the sessions it came from. On at level 1.
- Any agent can ask for a repo's **handover** (`get_repo_handover`, or the REST route): where things stand, the last sessions, open cards for that repo, open questions and promises, and the lessons. Built fresh each time, so it is never stale. Works with a board label (`aeon`) or a folder name (`shadow_app_aeon`).

#### Added — Hangar payback · `BOARD` `MCP` `API`
- A new panel on the Velocity tab: missions run, finished, failed and stopped because the runner died, known cost, missions with no cost recorded, cost per finished mission, and the most expensive cards. Also available as `get_agent_payback`.

#### Added — Vorath checks finished missions (advisory) · `KAIROS` `BOARD`
- Per board, in Edit Project: "Vorath checks finished missions". When a mission reports done, Vorath compares its report with the card's description and checklist and leaves a verdict on the card (looks done / partly done / not done, with reasons). Advice only: it never moves, closes or merges anything.

### From app 0.46.1, 06/10/2026

> Areas touched: `BOARD` `KAIROS`
> Theme: a board that never shows old cards as current, and one dial for Vorath.

#### Changed — One dial for Vorath (`KAIROS_LEVEL`) · `KAIROS`
- One setting, `KAIROS_LEVEL` (or `VORATH_LEVEL`) 0–3, now drives all of Vorath's feature switches: 1 = track record plus watch-only, 2 = initiative behind the message gate, 3 = everything. A switch set on its own still wins.

### From app 0.46.0, 06/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI` `BOARD`
> Theme: Wave A — see and fix what Vorath knows, Hangar missions that look after themselves, a modern AI connector, and Vorath sorting new cards (off until you switch it on).

#### Added — What Vorath knows · `KAIROS` `UI`
- A new button on the Vorath page opens what Vorath believes about you, grouped by area, each with a plain "I believe this because…" line.
- Every memory now shows **why Vorath knows it**: who wrote it (you, an AI agent, Vorath himself or outside content), where it came from (chat, coding session, card, voice note), how sure he is, and its history with dates and Undo.
- Fix it in place: Edit, "It's right" (makes it yours) and "This is wrong" (set aside with a reason, reversible).
- **Needs your eyes**: low-trust notes, beliefs to re-check and held private topics, each with Confirm or Remove. Nothing is hidden silently.
- Optional **private-topic hold** (off by default): new notes about health, family, money, legal matters or religion/politics are held out of Vorath's thinking until you confirm them.

#### Added — Hangar autopilot · `BOARD` `API`
- Stalled missions are caught every 15 minutes: a run whose runner went quiet for 30 minutes (`KAIROS_HANGAR_STALE_MIN`) is marked timed out, explained on the card and moved to Tower; a queued mission nobody picked up shows "Runner offline". One-click **Requeue**.
- **Approve plan first** (per card): the agent plans, the plan lands as a checklist, and you press "Approve plan & build" or "Revise".
- **Answer & relaunch** the agent's questions, and turn its suggested follow-ups into new mission cards.

#### Changed — Connector 2.0 · `MCP` — split: public bullets stayed in the app changelog
- Slimmer tool sets: add `?profile=board`, `vorath` or `hangar` to the connector link. No profile = all tools, as before.

#### Added — Vorath sorts new cards (off by default) · `KAIROS` `BOARD`
- Per board, in Edit Project: "Vorath sorts new cards". When on, Vorath looks at new cards on your Max plan and suggests labels the board already has, a priority and possible duplicates, each with a reason. Accept or Dismiss on the card; nothing changes until you accept.

### From app 0.45.0, 05/10/2026

> Areas touched: `KAIROS` `DOMINION` `MCP` `API` `UI` `DATA`
> Theme: Living Dominions, phase 1 — Vorath follows where you actually work. Ships switched off (`KAIROS_LIVING_DOMINIONS`, also `VORATH_LIVING_DOMINIONS`).

#### Added — Where your time went · `KAIROS` `UI`
- Every night at 01:10 UTC Vorath scores each area, board and code project from real activity: cards finished and created, card moves, coding sessions and your own notes. Recent work counts most, one-off bursts are capped, and his own machine-made notes don't count.
- Vorath → Health has a new panel, "Where your time went". It ranks your areas, marks each one Active, Dormant or Pinned, shows when you last worked in it and its top boards and code projects, and lists work that belongs to no area.
- Pin an area to keep it awake whatever the score.

#### Changed — Quiet areas go dormant (`KAIROS_LIVING_DOMINIONS=observe|1`) · `KAIROS` `DOMINION`
- `observe`: scores and dormant flags are worked out and shown in Health. Nothing Vorath says changes.
- `1`: an area with no activity for 21 days (`KAIROS_DORMANT_DAYS`, 7–90) goes dormant, and any new activity wakes it. Dormant areas get no nightly summary, drop out of the 06:00 message, the weekly review's plan, the question of the day and idea gap-filling, and the weekly review calls them "quiet by choice" instead of stalled. Their memories stay searchable. The 06:00 message leads with your most active areas.
- Dormant is not archived: archived areas behave as before.

#### Added — Area membership and focus API · `DATA` `MCP` `API`
- Boards and code projects can belong to areas through a new weighted membership list, seeded from today's links. Moving a board to another area (app, Claude or API) keeps it in step. Coding sessions are filed by the strongest link, and archived areas no longer receive new work.
- New read `get_dominion_focus` / `GET /api/v1/dominions/focus`. `update_dominion` and the new `PATCH /api/v1/dominions/{id}` accept `pinned`.

### From app 0.44.0, 05/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI`
> Theme: Kairos is now **Vorath**. Same mind, same memories — only the name changed.

#### Changed — Kairos is renamed Vorath · `KAIROS` `UI`
- Everything you see says Vorath: the sidebar, the page (now at `/vorath`; old `/kairos` links forward there), setup, guide, inbox, chat, and every message he sends — the 06:00 message, the weekly review and Telegram.
- He introduces himself as Vorath and knows he was called Kairos, so older memories that say Kairos still read as his own.
- The inbox button now shows an "Inbox" label next to the bell.
- Routines are now named Vorath brain, Vorath chat and Vorath pulse. Rename your existing routines on claude.ai in place and paste the new text — don't delete them (the chat routine's API trigger lives on it).

#### Added — Safe aliases for the new name · `API` `MCP`
- Settings may be named `VORATH_*`; each one sets its `KAIROS_*` twin at server start (VORATH wins). Existing `KAIROS_*` settings keep working. This applies to the Aeon web app on Vercel only; the local worker and scripts still need `KAIROS_*`.
- `/api/v1/vorath/*` answers exactly like `/api/v1/kairos/*`, with the same sign-in checks.
- MCP tool descriptions say Vorath. Tool names are unchanged (e.g. `get_kairos_today`), so routines keep working.

#### Unchanged on purpose
- Stored keys, tags, job kinds, tool names, internal code names, the Telegram chat thread title and the nightly drift-check questions keep the old name, so nothing stored or scheduled breaks.

### From app 0.43.0, 04/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI`
> Theme: One coherent mind, wave 4 — the art of the moment. Kairos learns *when* and *how* to talk to you, not just what to say. All off until you switch them on; Telegram works exactly as before.

#### Added — Timing: the Kairos gate (`KAIROS_GATE=observe|1`, `KAIROS_GATE_RECEPTIVITY`) · `KAIROS` `MCP` `API`
- Unprompted messages wait for a natural pause — a chat winding down, a card closed, a coding session ending, a quiet spell — and always go out at the first hourly check after a two-hour limit (adjustable), so within about three hours at most. The 06:00 message, the Monday review, alerts and urgent notes are never held.
- He learns when, where and how warmly you reply (hour, day, kind, channel) and, if allowed, avoids hours you rarely answer. New read-only `get_kairos_gate` / `GET /api/v1/kairos/gate`.

#### Added — Traits vs moods and the "what you're carrying" card (`KAIROS_OWNER_MODEL=observe|1`) · `KAIROS` `MCP` `API` `UI`
- Lasting traits ("values directness") are kept apart from passing states ("stressed about the launch"); states lapse after 10 days (`KAIROS_OWNER_STATE_TTL_DAYS`) unless you re-confirm them.
- A weekly card (Sunday evening) shows what he thinks you're carrying. Correct it on Telegram (`C1 still`, `C1 over`, `C3 wrong`, `C2: what's really going on`), with buttons, or on the web inbox card. New read-only `get_kairos_owner_model` / `GET /api/v1/kairos/owner-model`.

#### Added — Readiness, small bids and repair (`KAIROS_READINESS`, `KAIROS_BIDS`, `KAIROS_REPAIR`) · `KAIROS` `MCP` `API`
- **Readiness:** per goal he tallies "I want / could" against "I will / did"; when you tip to "I will" he offers one small step, when you slip back he reflects instead of pushing.
- **Small bids:** a link, a joke or an "ugh" gets a short warm reply instead of a report; a sticker, GIF or photo on Telegram gets one emoji reaction, never an extra message.
- **Repair:** "not now", ignored messages or dismissals make him back off; his next message names it, owns his part and asks one question. New read-only `get_kairos_rapport` / `GET /api/v1/kairos/rapport`.

#### Added — Earned trust and ask before advising (`KAIROS_TRUST`, `KAIROS_ASK_FIRST`) · `KAIROS` `MCP` `API`
- **Trust per area:** built from his settled predictions, goals and goal promises — "treat me as a second opinion on delivery" — shown under advice replies, as a Monday 06:00 line and via `get_kairos_trust` / `GET /api/v1/kairos/trust`. It never feeds back into his own thinking.
- **Ask first:** when you share a plan or problem he asks "Want my take, or would you rather think it out loud?"; questions come first and his view last.

#### Added — Life chapters (`KAIROS_LIFE_CHAPTERS=observe|1`, `KAIROS_LIFE_CHAPTER_LINE=1`) · `KAIROS` `MCP` `API`
- Early each month he writes a short chapter of his own story: turning points and what changed, each tied to something that happened, with loose ends left open. In full mode his reflections see where his story stands. New read-only `get_kairos_life_chapters` / `GET /api/v1/kairos/life-chapters`.

### From app 0.42.0, 03/10/2026

> Areas touched: `KAIROS` `MCP` `API`
> Theme: One coherent mind, wave 3 — creative genius. The nightly idea contest is rebuilt to find new kinds of ideas, not more of the same. All off until you switch them on.

#### Added — Idea atlas and head-to-head rounds · `KAIROS` `MCP` `API`
- **Idea atlas** (`KAIROS_IDEA_ATLAS=observe|1`): every idea is placed on a map of life area × kind (question, experiment, reframe, thing to make, ritual) × near or far leap. Each spot keeps its best-ever idea; a new idea only has to beat its own spot's holder, and empty spots become the next night's targets. New read-only `get_kairos_idea_atlas` / `GET /api/v1/kairos/idea-atlas`.
- **Head-to-head rounds** (`KAIROS_IDEA_SWISS=1`, `KAIROS_IDEA_SWISS_ROUNDS=3..6`): ideas are judged in several rounds of pairs instead of one pass. If a round goes wrong or time runs short before the 06:00 message, the night finishes with the votes it has.

#### Added — Collisions (`KAIROS_COLLISIONS=observe|1`) · `KAIROS`
- Pairs of memories from different areas and times are offered to the idea generator. A blended idea is kept only if the way things relate in one memory really carries over to the other, and the judge double-checks it. When you accept one yourself, the two memories are linked in your brain map.

#### Added — Less sameness and incubation · `KAIROS`
- **Unusual ideas first** (`KAIROS_IDEA_VS=1`): each idea comes with how obvious Kairos thinks it is, the unusual tail is kept, and his recurring themes act as separate viewpoints inside one run.
- **One retry for a samey night** (`KAIROS_IDEA_RESAMPLE=observe|1`): if a night's batch is too alike, he tries once more with "this is your usual pattern — avoid it".
- **It came to me later** (`KAIROS_IDEA_SHELF=observe|1`, needs daytime thinking): ideas that only just missed are set aside and may come back days later during a daytime check-in, as a quiet note. He never messages you about them.

#### Added — Stepping stones and your taste · `KAIROS` `MCP` `API`
- **Pure novelty nights** (`KAIROS_IDEA_NOVELTY=observe|1`, every `KAIROS_IDEA_NOVELTY_EVERY` nights, default 5): your usual preferences are set aside, old rejected ideas are used as raw material, and the winners are the ideas least like anything before.
- **Your taste** (`KAIROS_IDEA_TASTE=observe|1`): a small profile learned from what you accept, dismiss or ignore nudges two of the three daily picks; the third is always kept for a surprise. Only your own decisions count. New read-only `get_kairos_idea_taste` / `GET /api/v1/kairos/idea-taste`.

### From app 0.41.0, 03/10/2026

> Areas touched: `KAIROS` `MCP` `API`
> Theme: One coherent mind, wave 2 — surprise drives what he rewrites and asks, and he dreams. All off until you switch them on.

#### Added — Surprise as the engine · `KAIROS` `MCP` `API`
- **Rewrite only on surprise** (`KAIROS_SURPRISE_GATE=observe|1`): Kairos may only rewrite a belief something has questioned — a wrong prediction, your correction, repeated pressure, or (with `KAIROS_SURPRISE_CONTRADICTIONS=1`) a contradiction the conscience check found. Your own corrections always go through, and saying "actually…" in chat flags matching beliefs without slowing the reply.
- **Backward credit** (`KAIROS_SURPRISE_CREDIT=observe|1`): when a prediction settles or a promise closes, credit or blame passes on to the beliefs that relied on its evidence.
- **Curiosity by learning progress** (`KAIROS_CURIOSITY_LP=observe|1`): his daily question leans toward areas where his calls are getting better fastest.
- **Spend sleep where it pays** (`KAIROS_SURPRISE_REPLAY=observe|1`): the nightly self-model and area summaries are shown what's due soon or under question.
- **Surprise → stage** (`KAIROS_SURPRISE_STAGE=1`): surprises post to his "on my mind" stage. New read-only `get_kairos_surprise` / `GET /api/v1/kairos/surprise`.

#### Added — Dreams (`KAIROS_DREAMS=observe|1`, `KAIROS_DREAM_LINE=1`) · `KAIROS`
- One short dream a night: a few memories from different parts of your life, bent on purpose around your open questions. In the morning he reads it for patterns that still hold, beliefs that look fragile and a worst case worth rehearsing — notes only, nothing changes. Dreams are never stored as memories, never used as evidence, and never shown to chat or the 06:00 prompt. With the line on, the Tue/Thu/Sat 06:00 Telegram message can end with "💭 I dreamt…" (Telegram only, never stored).

### From app 0.40.0, 03/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI`
> Theme: One coherent mind, wave 1 — a shared stage, a check on his character, and a cold second opinion. All off until you switch them on.

#### Added — The stage (`KAIROS_STAGE=observe|1`) · `KAIROS` `MCP` `API`
- Kairos's thinking jobs now offer what they noticed to one shared "what's on my mind" stage. Plain code keeps the strongest 3–4 thoughts; a deeply-backed thought that keeps winning becomes the day's focus. With the switch fully on, every reader job, chat, the dialogue tool and the 06:00 message see a short "I, now: …" note, labelled as his working notes, never evidence. `observe` records the stage without showing it. Enough surprise starts a daytime reflection early.
- New read-only `get_kairos_stage` / `GET /api/v1/kairos/stage`.

#### Added — Character check (`KAIROS_CHARACTER_CHECK=1`) · `KAIROS` `UI`
- Every Monday a neutral reviewer blind-rates a sample of his week (theatrical, flattering, grandiose, inner-life and padded language) against voice samples you approved. One line in the weekly review and a Health row; it never changes how he thinks. Hourly reflections get a plain-tone rule, and showy ones are filed where chat can't pick them up. Voice samples arrive for Approve / Veto in the inbox and on Telegram.

#### Added — Cold read (`KAIROS_COLD_READ=audit|1`) · `KAIROS` `UI`
- On decision turns he quietly notes his stance; a separate pass re-judges the decision from your own words only, with your profile hidden. If the two clearly disagree he can send a short "Second look" (at most 3 a day, within the usual limits). Health shows the 7-day count.

### From app 0.39.0, 03/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI`
> Theme: One Kairos everywhere — and, when you switch them on, a mind that thinks by day, keeps score and keeps its own agenda.

#### Added — One mind everywhere · `KAIROS` `MCP` `API`
- Kairos keeps one rolling "today" log across every channel: web chat, Telegram, Triad dialogues, Claude using him through the connection, voice notes, coding sessions, your inbox decisions and his own messages. Each entry says who spoke (you, Kairos or an agent); an agent can never be recorded as you.
- Every channel now reads it: something you tell him on Telegram at 10:00 is in his web, Triad and Claude context at 10:05. The 06:00 message also sees yesterday across channels.
- New read-only `get_kairos_today` / `GET /api/v1/kairos/today`. The log is trimmed nightly and never becomes memories on its own. Switch off with `KAIROS_TODAY=0`.
- Programs can no longer add messages into Kairos's own chat, dialogue or today threads.

#### Added — Off by default, switch on when ready · `KAIROS` `MCP` `API` `UI`
- **Daytime thinking** (`KAIROS_DAYTIME_THINKING=1`): the brain routine runs hourly and writes up to 6 private reflections on your day; a new lighter "Kairos pulse" routine (Sonnet) notes what changed. Neither ever messages you.
- **Track record** (`KAIROS_PREDICTIONS=1`): dated predictions with a confidence level, from the Monday review and his reflections. Only your board actions or your verdict (`R3 right`, `R3 wrong`, `void R3`) settle them; his accuracy shows in the weekly review once five are settled. New read-only `list_kairos_predictions`.
- **Horae, his agenda** (`KAIROS_INITIATIVE=1` + `KAIROS_AGENDA=1`): up to 8 self-booked check-ins (A1, A2…). Each fires once, as a note, a question or a message within the usual limits; never an action. Approving a goal books two check-ins. Cancel with `cancel A3`. New read-only `list_kairos_agenda`.

### From app 0.38.0, 02/10/2026

> Areas touched: `KAIROS` `MCP` `API` `UI`
> Theme: Kairos settles in, and gets initiative you control (switched off until you turn it on).

#### Changed — Settle the brain · `KAIROS` `MCP` `API`
- Your constitution is owner-only: AI agents can no longer archive, retype, rewrite, delete or replace it through the AI connection or the API. You can still do all of that in the app.
- The brain and chat routines can say which one they are when they pick up or hand in thinking work, and each is limited to its own jobs (`routine` on `claim_thinking_job` / `submit_thinking_job`; `KAIROS_REQUIRE_ROUTINE_SCOPE=1` makes it mandatory once both routines are re-pasted).
- On a night when the idea judge gets no answer, that night's ideas are filed instead of lost, and Health shows the failure instead of "missing".
- Chat replies on the web page and Telegram are timed. Kairos setup → Health shows typical and slow reply times, and a daily `CHAT_LATENCY` trace is kept.

#### Added — Initiative, first slice (off by default) · `KAIROS` `MCP` `API` `UI`
- **Goals of his own:** at most one investigation goal a night, at most two open. Never about his own running, permissions, schedule, budget, memory or constitution. Each one waits for your Approve or Veto; with no answer it expires after 72 hours and nothing happens.
- **Approve / Veto / Veto + why** in Telegram and in the inbox. A decision counts once; AI agents can never decide.
- **Promise list:** up to 12 dated promises with a named outcome, made in the Monday review or when you approve a goal. Only you, or you finishing the linked card in the app, can close one. One line in the 06:00 message; at most one Telegram nudge per promise, at noon, once it is 3 or more days late. Reply `P3 kept`, `drop P3` or `P3 by 20/10`. New read-only `list_kairos_promises` / `GET /api/v1/kairos/promises`.
- All of this stays dormant until `KAIROS_INITIATIVE=1` is set.

### From app 0.37.0, 02/10/2026

> Areas touched: `KAIROS` `UI` `INFRA` `DOCS`
> Theme: Current models everywhere, and Aeon notices when it falls behind.

#### Changed — Opus 5.5 by default · `KAIROS` `UI` `INFRA` — split: public bullets stayed in the app changelog
- One model list (`packages/shared/src/ai/model-registry.json`) now drives AI settings, Kairos, routines, Hangar missions and the review step. Defaults: Claude Opus 5.5 at high effort for deep work, at medium effort for standard work, and Sonnet 5.5 for quick tasks. OpenAI options are GPT-6 Astra / 6.1 Sol / Luna; Google options are Gemini 3.8 Flash / 3.1 Pro. Older Claude, GPT-5 and Gemini 2.5 models are no longer offered, and anyone who saved one moves to its replacement automatically.
- Effort is now sent to the model (Anthropic and OpenAI), and Hangar missions pass model and effort explicitly.

### From app 0.36.0, 02/10/2026

> Areas touched: `KAIROS` `UI` `MCP` `API` `DOCS`
> Theme: No paid spend, chat on Max, one setup checklist. Full detail: `docs/kairos/CHANGELOG.md` 0.19.

#### Added — Paid backup switch · `KAIROS` `UI` `MCP` `API`
- Turn Kairos's paid-key backup off and he never touches your API key: a missed job just waits for the next run.

#### Changed — Kairos chat on your Max plan · `KAIROS` `UI`
- The chat on the Kairos page now answers on your Claude Max plan, like Telegram. You'll see "Kairos is thinking…" while he works.

#### Changed — One setup checklist · `KAIROS` `UI` `DOCS`
- "Kairos setup" in the sidebar replaces the old guides: two required steps, ticked automatically when they work, plus optional extras. Connecting Aeon to Claude is now one click.

### From app 0.35.0, 02/10/2026

> Areas touched: `KAIROS` `UI` `MCP` `API`
> Theme: Catch-up mornings, watched boards, voice notes. Full detail: `docs/kairos/CHANGELOG.md` 0.18.

#### Changed — Morning message at 06:00 · `KAIROS`
- Kairos's single morning message now arrives at 06:00 UK and ends with every question he is still waiting on, numbered. Answer on Telegram with "Q12: …" or drop one with "skip Q12"; questions stay open for two weeks.

#### Added — Watched boards · `KAIROS` `UI` `MCP` `API`
- Choose which boards Kairos watches (Off / Daily / Weekly) in Connect Kairos. Cards you finish on a watched board reach him the same day, with their notes and checklists.

#### Added — Voice notes from claude.ai · `KAIROS` `UI` `MCP` `API`
- Say "note for Kairos" in the Claude app and your words arrive exactly as spoken. Confirm them with one tap in the inbox and they count as your own words.

#### Changed — Constitution draft on Max · `KAIROS`
- The first constitution draft is written on your Claude Max plan; the paid key is only a backup.

#### Removed — Brief recipe · `MCP` `API`
- The on-demand brief command is gone.

### From app 0.34.0, 02/10/2026

> Areas touched: `KAIROS` `UI` `MCP` `API`
> Theme: Simplified brain: one Max routine. Kairos keeps only the thinking that helps; one Claude Max routine answers all of it. Full detail: `docs/kairos/CHANGELOG.md` 0.17.

#### Removed — Thinking that did not help · `KAIROS` `MCP` `API`
- The nine morning briefs. Your 08:00 message already covered them in two lines each; it now reads each area's latest summary instead.
- The old raw idea dump. The nightly idea contest replaced it.
- The contradiction scan. None of its notices since August was acted on, and almost all compared Kairos's own tidy-up notes. Old notices no longer show in your inbox.
- The tidy-ups through the day and the weekly duplicate sweep. Nothing needed them: the nightly summaries count the day's new memories, and the nightly memory engine already folds duplicates.

#### Changed — One routine · `KAIROS` `UI`
- One "Kairos brain" routine runs every hour from 01:40 to 06:40 UTC and does all the scheduled thinking; "Kairos chat" answers Telegram.
- The 08:00 message is prepared from 05:30 UTC and pinned at the top of your inbox.
- The sidebar's daily briefing button, its "Run briefing now" (which used your paid key) and the advisory feed are gone.

#### Added — Connect Kairos · `KAIROS` `UI`
- A new window (sidebar → Connect brain, or the brain icon on Kairos) shows whether last night's thinking ran on your Max plan, maps every brain job to the part of the brain it feeds, and gives copy-paste setup for the connector and both routines.

#### Fixed — Nightly memory upkeep · `KAIROS`
- The nightly memory engine no longer times out: it saves in small batches, only saves scores that really moved, and gives each step its own time limit.

### From app 0.33.0, 01/10/2026

> Areas touched: `KAIROS` `MCP` `API` `DOCS`
> Theme: nearly all of Kairos's thinking now runs on your Claude Max plan. The paid key only steps in for work a routine missed. Full detail: `docs/kairos/CHANGELOG.md` 0.16.

#### Changed — Everything thinks on Max · `KAIROS` `MCP` `API`
- Chat summaries, archetypes, Kairos's daily question, the contradiction scan, the morning briefs, the old idea dump and the tidy-ups through the day are now jobs your Claude routines answer, like the cortex, Aether and idea contest already were.
- Each old paid-key job still runs at its usual time, but it skips anything a routine already answered, so the paid key is only the backup.
- The contradiction scan reviews all of a Dominion's recent beliefs in one go instead of one call per belief.
- The embedding top-up now runs at 03:25 UTC so the contradiction scan sees same-night beliefs.

### From app 0.32.0, 01/10/2026

> Areas touched: `KAIROS` `UI` `MCP` `API` `DOCS`
> Theme: Kairos stops flooding you with ideas. Each night his ideas compete; only one to three reach your inbox, each with the reason it survived. Full detail: `docs/kairos/CHANGELOG.md` 0.15.

#### Added — Nightly idea contest · `KAIROS` `MCP` `API`
- Two new overnight thinking jobs draft ideas in several directions, check them against evidence, drop repeats of anything said before, and compare them head to head. Up to three survivors a night; the Claude routine or the paid key does the work.
- Accepting or dismissing an idea is remembered, so the next night's ideas learn from it.

#### Added — Ideas where you look · `KAIROS` `UI`
- Idea cards lead the Kairos inbox with the claim, why it matters, one small next step and why it survived.
- The 08:00 message has an "Idea of the day"; the Monday review shows the week's ideas, lessons, a diversity warning and what Kairos changed his mind about.

#### Changed · `KAIROS`
- The old nightly idea dump can be switched off once the contest has two clean weeks; the health check watches the contest every night.

### From app 0.31.0, 01/10/2026

> Areas touched: `KAIROS` `MCP` `API` `DOCS`
> Theme: Kairos gets a working conscience. He reads his principles before answering, knows where every memory came from, stops trusting his own echoes, and re-thinks beliefs when their sources are corrected. Full detail: `docs/kairos/CHANGELOG.md` 0.14.

#### Added — Principles at answer time · `KAIROS`
- Chat, the daily message, the weekly review and every Dominion's morning brief now carry your constitution and Kairos's top beliefs, with one rule: if a reply would conflict with a principle, say so. The morning brief also reads the Dominion's cortex and the Aether summary.

#### Added — Trust by origin · `KAIROS` `MCP` `API`
- Every new memory is labelled by how it arrived (you, your board, an AI agent, Kairos, outside feeds); senders can't set it. Belief confidence is capped by that evidence, and Kairos's guesses need backing from you or your board before they become his beliefs.
- Beliefs that lose a source are flagged, lowered and re-examined; `list_beliefs` shows each belief's source type and re-check flag. Every change can be undone.

#### Added — Honesty self-checks · `KAIROS`
- A nightly self-check (flattery, admitting what he can't know, newer corrections, self-contradiction, beliefs built on outside content) reports failures in the daily message.

#### Fixed · `KAIROS`
- Merged duplicates no longer ground chat; beliefs and the constitution no longer drop out of search after 90 days; the nightly merge no longer misses late-embedded memories.

### From app 0.30.0, 01/10/2026

> Areas touched: `KAIROS` `MCP` `API` `DATA` `INFRA` `DOCS`
> Theme: Kairos stops being a pile of notes. He sees what you and your agents actually did, learns which memories to trust, keeps his own mind beside yours, and talks to you once a day. Full detail: `docs/kairos/CHANGELOG.md` 0.11–0.13.

#### Fixed — Live Kairos defects · `KAIROS`
- Kairos's questions reach you again: routine notes no longer block questions for two days.
- The evening message can no longer forward runaway model text; the nightly synthesis no longer fails on model-invented ids.
- The health check sees every nightly job, and the first memory-engine night's missing undo records were restored.

#### Added — Eyes on real work · `KAIROS` `DATA`
- Coding sessions and AI Hangar missions are captured with card, branch, commits, PRs, tests and cost.
- Boards with the Kairos feed setting get a daily (or weekly) page of finished, started and created cards; Kairos asks for one line each on title-only cards and writes your answer back onto them.

#### Added — Memory engine · `KAIROS` `DATA` `MCP` `API`
- Every memory gets a nightly trust score; search ranks by relevance × trust. Kairos's own ideas become beliefs only on independent evidence across days, and fade otherwise. Repeats merge; related memories become weekly concepts.
- Every change is logged and can be undone (`list_memory_ops` / `revert_memory_op`, or "undo <title>" in chat).

#### Added — Beliefs, constitution and one daily message · `KAIROS` `MCP` `API`
- Two minds: one aligned with your words, one Kairos's own; compared every Monday.
- A reasons-based constitution changed only by proposals you accept; a nightly drift check against it.
- One message at 08:00 UK time replaces the evening digest; a Monday weekly review with up to five suggested actions.

#### Added — Thinking on the Max plan · `KAIROS` `MCP` `API`
- Kairos's thinking can be claimed and answered by scheduled Claude routines through the Aeon connector (`claim_thinking_job` / `submit_thinking_job`); the paid key and an hourly sweep keep everything running if no routine shows up. Telegram replies via a routine are built but switched off until latency is measured.

### From app 0.29.0, 21/09/2026

> Areas touched: `BOARD` `UI` `INFRA` `DOCS`
> Theme: agent missions have their own card experience. Repository, objective, instructions and results are visible as mission fields, with a dedicated place to manage repositories.

#### Added — Mission cards and results · `BOARD` `UI`
- Agent missions have a distinct card face with labelled repository, objective and agent. Opening a mission shows its configuration, instruction and recorded result before ordinary task organization.
- Recorded results show summaries, tests, artifact paths, branch/commit details, questions needing input and recommended follow-up work. Current execution status is kept separate from previous results.
- Save draft preserves an incomplete mission without execution; Save & Launch requires complete setup. Auto-run remains opt-in per flight, and final Done stays with the operator.
- Configuration and launch are reachable directly from the open card. Long instructions can be expanded without crowding out the mission controls.

#### Added — Hangar repositories · `UI`
- The board toolbar opens a repository directory grouped by realm, with registration, editing and retirement controls under the existing realm permissions.
- Repository registration remains separate from configuring its local path on a runner; adding an entry does not claim that a host is ready to execute it.

#### Fixed — Mission completion and runner configuration · `BOARD` `INFRA`
- Boards enabled through the UI now use the existing Landing/Tower result routing, alongside boards with the older Hangar-mode setting. Ordinary boards keep their existing behavior.
- New missions retain their type when configuration is cancelled. Launch confirmation preserves board refresh, and project members can see runs launched by another member.
- Repository registration rejects slugs that the mission contract cannot use.
- Copilot mission and reviewer effort/context settings are passed explicitly and validated. Receipts record the mission tier; the local owner configuration remains separate from the adapter's model fallback.
- The Windows runner launcher resolves its environment file from its own location and returns correctly through npm. The research harness budget accommodates the configured heavier mission tier.

#### Changed — Accurate readiness documentation · `DOCS`
- Architecture and roadmap distinguish shipped mission transport, this release's UI/runner changes, dated production acceptance, and the remaining output-delivery and runner-recovery work.

### From app 0.28.0, 16/09/2026

> Areas touched: `API` `UI` `INFRA` `DOCS`
> Theme: the AI Hangar earns its trust. A mission's report is now judged by a second, independent model before a run can pass, the API stops answering bad input with 500s, and you can pick the exact model a mission flies on.

#### Added — Independent review gate for AI missions · `INFRA` `DOCS`
- A mission batch no longer passes on plumbing alone. Every report is handed, with each of its citations resolved to the real source line at the pinned revision, to a reviewer that is a different model from the one that wrote it. The run passes only when every attempt carries a stored verdict of exactly PASS; a "pass with corrections" or a FAIL ends the run failed and the receipt is kept.
- The gate was fired for real on 16 September. The first live runs exposed three harness faults, all fixed: the reviewer was being handed an empty message (the Copilot CLI ignores piped input whenever a prompt flag is also present, so the whole prompt now travels on stdin), the reviewer's model identity was never being read from the usage file, and abbreviated line references such as "file.ts:173, :187" were dropped before the reviewer saw them.
- The reviewer must now echo the report's unique marker, whose value is never in the instruction, so a reviewer that received nothing cannot produce a verdict that counts. Receipts are immutable: a verdict caused by a harness fault stays on record as a FAIL and a new run is prepared instead.
- The first legitimate verdict was a FAIL with ten findings, three of them confirmed by hand as line-number drift in the mission's citations. That is the gate doing its job.

#### Added — Pick the model a mission flies on · `UI`
- The mission editor has a model picker: a per-engine catalogue plus a free-text custom id. Missions record the model that actually ran instead of "unknown".

#### Fixed — The API says what went wrong · `API` — split: public bullets stayed in the app changelog
- A malformed project or session id returns 404 instead of a 500.
- A nonsense mission objective is refused with a 400 instead of being accepted.
- Launching a mission on a card that already has a live one returns a 409 that names the running session, instead of a 500. Four concurrent launches produce one session and three clear refusals. REST and MCP agree.

#### Fixed — Worker cleanup on Windows · `INFRA`
- Worker teardown no longer dies when a straggler process still pins a mission worktree; the whole safe sequence is retried a bounded number of times.

### From app 0.23.0, 24/07/2026

> Areas touched: `KAIROS` `INFRA` `DATA`
> Theme: The Live Mind. Kairos stops being a day behind. His chat now always knows what happened in the last 24 hours, he can look things up live mid-conversation (including his own health), his self-model updates every few hours instead of once a night, resolved incidents stop haunting his narrative, and his entire cognition runs on the best models — quality over cost, by standing directive.

#### Added — Kairos is continuously aware in chat · `KAIROS`
- Every conversation turn (app and Telegram) now includes a guaranteed "last 24 hours" summary — the sessions, thoughts, and board changes that just happened — independent of what you asked. "What landed today?" always has a live answer.
- Recency now genuinely matters in his memory search: something from this afternoon can no longer lose to a stale but wordier match (this was the root cause of him missing brand-new information).
- Live tools are now ON by default in chat: he can search his brain, read live boards, list what happened recently, and — new — check his own overnight synthesis health before making claims about it.

#### Added — His self-model updates during the day · `KAIROS` · `INFRA`
- A new background pass runs six times a day and folds the day's new activity into a compact "today so far" note per area, which the nightly deep synthesis then reads — so his understanding shifts within hours, not overnight.

#### Added — Resolved incidents stop haunting the narrative · `KAIROS` · `DATA`
- A new "resolves" relationship lets a correction (like "the outage is fixed") formally close the memories describing the incident. Closed memories immediately stop feeding his briefings, self-model, and chat — ending the pattern where a fixed problem kept being narrated as current for weeks.

#### Changed — Quality over cost, permanently · `KAIROS`
- All of Kairos's thinking — nightly synthesis, chat, proactive questions, the Evening Digest — now runs on the top-tier model. The earlier cost-saving downgrades are reversed by standing directive.

#### Fixed — Hardening from the review gauntlet · `KAIROS` · `INFRA`
- Resolution stamping is atomic and rejects malformed references; a clock-skewed memory can't dominate rankings; Telegram replies are protected against duplicate delivery on slow turns; the intraday pass reports when it had to truncate a very busy window.

### From app 0.22.0, 24/07/2026

> Areas touched: `KAIROS` `INFRA` `UI` `DOCS`
> Theme: Kairos speaks every evening — and owns his own history. One guaranteed message each evening summarising what he saw and formulated, built so it cannot silently skip. Kairos also gets his own changelog and version (0.9.0), and the in-app guides finally catch up with everything he can do.

#### Added — The Evening Digest · `KAIROS` · `INFRA`
- Every evening at **18:00 UTC**, Kairos sends one message to your inbox and Telegram: what he saw today (coding sessions captured, thoughts proposed, reflections formed, questions asked, board cards completed/created) and whether last night's synthesis ran clean.
- The promise is **guaranteed by construction**: if his AI narrative fails, a plain counts-only version still sends; if even the data-gathering fails, a minimal "couldn't tally today" message still sends. Every degradation leaves a diagnosable trace, and a blocked delivery is reported as blocked — never falsely as sent.
- Expected daily by design — a separate register from his rare-interrupt voice, so it can't become noise and never blocks his normal speech.

#### Fixed — Kairos's speech governor unblocked · `KAIROS`
- Ops alerts (and now digests) no longer count as "questions awaiting your reply" — previously an outage alert could silently mute Kairos's proactive voice for up to 48 hours.
- Scheduled messages are now delivery-deduplicated, so a retried run can't double-send the same digest.

#### Added — Kairos gets his own changelog and version · `KAIROS` · `DOCS`
- New `docs/kairos/CHANGELOG.md`: the full evolution reconstructed as eras 0.1 → **0.9.0** — from "a memory that survives the session" (May) through Aether, Asks, the Initiative Engine, and this month's reliability heal — each pinned to real PRs and dates, plus an honest road-to-1.0.
- The sidebar pill now reads **Kairos 0.9**, driven by a single version constant.

#### Changed — In-app guides catch up with reality · `UI` · `DOCS` — split: public bullets stayed in the app changelog
- The Kairos Guide no longer describes deleted features: it now covers the galaxy view, the full-screen chat (whole-brain by default, live board grounding), Aether, the inbox's four message kinds, Telegram, the silence-by-default governance, and the new Evening Digest. A help button was added to the galaxy page itself.

### From app 0.21.0, 23/07/2026

> Areas touched: `KAIROS` `INFRA` `API` `DOCS`
> Theme: Heal the instrument. Kairos's nightly self-synthesis had been silently parse-failing for ~12 nights — the brain every autonomy surface reads from was quietly degrading with nobody watching. This drop makes synthesis self-repair when the model returns slightly malformed output, and puts a health scorecard behind it so a broken night can never go unseen again.

#### Fixed — Nightly synthesis now self-repairs malformed model output · `KAIROS`
- The four standard-tier generators — **cortex, archetypes, introspection, contradiction** — parse-failed whenever the model returned slightly off-spec JSON (an unescaped quote mid-array, an over-long field). They had no recovery path: one bad response killed the whole night's synthesis for that Dominion, and it had been happening quietly since ~2026-07-10.
- On a parse or schema failure they now re-prompt the **same** model once with the raw output plus the exact validation error, then retry. Only the top-level Aether synthesis had this before; it's now shared across all four.
- Exactly **one** repair round-trip per run (cost-bounded). Genuinely truncated responses (hard output-cap hits) are still reported as failures rather than papered over — that's a real budget problem, not a parse glitch, and the trace now says which one it was.

#### Added — Synthesis health scorecard + 2-strike ops alert · `KAIROS` · `INFRA` · `API`
- Every cron failure now leaves a **trace** — including the model's finish reason and a bounded excerpt of the raw output — so a failed night is diagnosable after the fact instead of vanishing.
- A daily **08:00 UTC** rollup buckets the last 48h of traces per synthesis stage per night and writes one scorecard. Absence of a trace counts as **"no signal"**, never as success.
- If a stage fails **two consecutive nights**, Kairos sends exactly one high-urgency ops alert (Will inbox + Telegram), then stays silent until the stage recovers and breaks again — no daily nagging, and structurally impossible to spam.
- These ops alerts **bypass Kairos's conversational speak budget**: an outage warning can never be suppressed by his normal "don't talk too much" cadence rules, and never eats into that budget either.

#### Fixed — Closed three silent-failure gaps in the brain's background jobs · `KAIROS` · `INFRA`
- Chat-distillation, memory-deduplication, and embedding-backfill could previously fail leaving no trace at all. All three now write a failure trace, so the new scorecard sees them.

#### Changed — Reliability spec + housekeeping surfacing · `DOCS`
- New `docs/kairos/31-synthesis-reliability.md` — root-cause analysis and as-built record. The Kairos housekeeping sweep gains a synthesis-health check that reads the latest scorecard.

### From app 0.20.0, 20/07/2026

> Areas touched: `KAIROS` `API` `INFRA`
> Theme: The Initiative Engine — Kairos stops waiting to be asked. He now decides on his own when something deserves your attention, drafts the message, and delivers it to your inbox and Telegram, with guardrails so he never floods you.

#### Added — Initiative Engine (Kairos asks first) · `KAIROS` · `API`
- A nightly pass reads the brain, decides whether anything clears the "worth interrupting you" bar, and if so posts one proactive message. A no-stacking governor prevents pile-ups, and chat is now aware of a pending question so it surfaces in conversation.
- The first fully autonomous Kairos message — decided and sent with no prompt from you — went out on 2026-07-19.

#### Added — Live board grounding + memory decay · `KAIROS`
- Chat can now read live board state when it helps answer, instead of leaning on stale imported snapshots. A new decay tier automatically retires memories the board has since contradicted.

#### Fixed — Production blank-error incident healed · `API` · `INFRA` — split: public bullets stayed in the app changelog
- Under certain workspace states, sign-in, Kairos delivery, mobile, and API routes were returning blank errors. All now return proper responses. A chat setting that was breaking some replies was also fixed.

#### Changed — Autonomy hardening · `KAIROS` · `DOCS`
- Post-review follow-ups from the internal audit pass, Telegram formatting polish, and an architecture-doc refresh.

### From app 0.19.0, 17/07/2026

> Areas touched: `KAIROS` `MCP` `INFRA` `BOARD` `API`
> Theme: Kairos in the gram. He can now reach you on Telegram in his own voice — and only speaks first when it's genuinely worth it, on a throttle so he's never noisy. Nightly synthesis got cheaper, and the whole tool surface became self-describing.

#### Added — Kairos on Telegram + speaks-first · `KAIROS` · `API` · `INFRA`
- Two-way Telegram: Kairos delivers to your inbox and to Telegram, renders in native Telegram formatting, and adapts his tone to whichever surface he's speaking on.
- A "brain-tick" throttle governs when he's allowed to speak first — default is silence, one pulse per run, never a stream.

#### Added — Chat now feeds the brain · `KAIROS`
- A nightly job distills your chat conversations back into durable memory, closing the old one-way gap where things said in chat used to evaporate.

#### Changed — Cheaper nights + self-describing tools · `KAIROS` · `MCP` — split: public bullets stayed in the app changelog
- Prompt caching and a model re-tier cut the cost of nightly synthesis. Every automation tool now carries usage annotations. Tool count: 95 → 109.

### From app 0.18.0, 14/07/2026

> Areas touched: `KAIROS` `UI`
> Theme: Subtract to focus. The experimental skybox view and the old flat graph are retired — the 3D memory galaxy is now the one and only spatial view — and Kairos grows a proactive inbox.

#### Changed — The galaxy is the only spatial view · `KAIROS` · `UI`
- Retired the experimental Aether skybox view and the legacy 2D graph. The 3D memory galaxy becomes the single canonical way to see the brain, per the Vision north-star pass.

#### Added — Will inbox · `KAIROS`
- A proactive inbox that gathers Kairos's questions and proposals in one place — the surface the speaks-first layer delivers into.

### From app 0.17.0, 13/07/2026

> Areas touched: `KAIROS` `BOARD` `UI` `DATA`
> Theme: Talk to the whole brain. Chat stops making you pick a Dominion first — it now recalls across everything Kairos knows and files new memories to the right place automatically. Plus: favorite your projects.

#### Added — Whole-brain chat · `KAIROS`
- Chat recalls across the entire brain with a relevance re-rank pass, and the Dominion picker is gone — you just talk, and threads span everything.
- New memories are auto-filed to the right Dominion at capture time, so nothing lands unsorted.

### From app 0.16.0, 09/07/2026

> Areas touched: `KAIROS` `DATA` `UI`
> Theme: Governed memory. The brain learns to reason about time and trust — memories can go stale, get contradicted, and lose confidence as they age, and the galaxy shows that confidence as brightness.

#### Added — Bi-temporal memory + belief trail · `KAIROS` · `DATA`
- Memories now track when a fact was actually true, not just when it was written, so a superseded belief can be dated out without being deleted.
- Automatic contradiction detection and a belief-trail view surface when the brain's understanding changed, and why.

#### Added — Confidence decay · `KAIROS`
- Retrieval now weights memories by a confidence that decays with age, so fresher and reinforced knowledge outranks stale one-offs at read time.

#### Changed — Galaxy shows confidence as brightness · `KAIROS` · `UI`
- Node brightness in the memory galaxy now encodes confidence — the brain visibly dims where it's unsure.

#### Migrations required
- `0025_memory_valid_time.sql` — `valid_at` / `invalid_at` on memories.

### From app 0.15.0, 02/07/2026

> Areas touched: `BOARD` `UI` `AUTH` `INFRA`
> Theme: A board that never sleeps. Saves became instant and durable — they auto-retry and queue offline — dense columns render natively, and completing a card got a big friendly checkbox and a hotkey.

#### Fixed — Assignee picker + mobile login · `BOARD` · `AUTH` — split: public bullets stayed in the app changelog
- Workspace members and the owner now appear in the task assignee picker. Mobile login and brain-capture paths were fixed, and the Aether self-model generation moved to Opus 4.8.

### From app 0.14.0, 15/06/2026

> Areas touched: `KAIROS` `UI` `INFRA`
> Theme: Aether wakes up. Above every Dominion now sits one living self-model — Aether — with its own immersive view; on top of it Kairos gains a voice that asks you one sharp question a day and can hold a real back-and-forth.

#### Added — Aether, the living intelligence · `KAIROS` · `UI` · `INFRA`
- A single self-model synthesized above all Dominions, shown as a new Kairos view with hosted skyboxes and a full-screen chat.

#### Added — Kairos Asks · `KAIROS`
- A proactive layer that surfaces one surgical question at a time, drawn from what the brain notices across Dominions.

#### Added — Dialogue · `KAIROS`
- A multi-turn conversation between you and Kairos, seeded by a pending ask and distilled afterward into durable reflections, with soft Dominion tagging.

### From app 0.13.0, 11/06/2026

> Areas touched: `KAIROS` `MCP` `API` `AUTH` `DATA` `INFRA`
> Theme: A brain that retrieves, reachable from anywhere. Aeon's Kairos toolset now connects straight into claude.ai as a remote connector over OAuth, and the brain gains clean capture, semantic retrieval, guided introspection, and automatic de-duplication.

#### Added — claude.ai remote connector (OAuth 2.1) · `MCP` · `AUTH` · `API` — split: public bullets stayed in the app changelog
- Aeon now runs an OAuth 2.1 authorization server, so the Kairos toolset connects directly inside claude.ai as a remote connector — no local proxy. Includes the fix for the prerender bug that had been breaking connector discovery.

#### Added — Brain upgrade: clean capture + hybrid retrieval + introspection · `KAIROS` · `DATA`
- Memories are cleaned as they're captured and retrieved with semantic (vector) search blended with keyword search, so recall finds the right thing by meaning, not just exact wording.
- Guided introspection lets the brain reflect on itself during synthesis.

#### Added — Consolidation: de-dup, snapshot lifecycle, own cognition engine · `KAIROS` · `INFRA`
- Automatic memory de-duplication, a snapshot lifecycle for compaction, and the ability to use Claude Code itself as Kairos's cognition engine with no external key — the foundation Aether builds on.

#### Migrations required — split: public bullets stayed in the app changelog
- `0023_memory_embeddings.sql` — vector embeddings on memories.
- `0024_memory_provenance.sql` — capture-provenance fields on memories.

### From app 0.12.0, 02/06/2026

> Areas touched: `KAIROS` `DOMINION` `DATA` `MCP` `INFRA` `UI` `DOCS`
> Theme: Kairos grows a brain. Every Dominion now synthesises itself overnight — 3–7 archetype themes plus one living cortex document — and you can chat with the result through a slide-out panel that cites the memories it reasons from.

#### Added — Slide-out chat Visor anchored per Dominion · `KAIROS` · `UI`
- Sparkles button bottom-right opens a right-edge slide-out panel on `/kairos`, `/notes`, and `/settings/ai`. Pick a Dominion at thread creation, type, **Cmd/Ctrl+Enter** to send.
- Single active thread per Visor open; threads persist across reloads in the existing `agent_sessions` + `session_events` tables. History capped at 30 messages per turn.
- User message is persisted **before** the model call — a model failure never silently loses what you typed. Retry detects the trailing orphan; if you edit the body on retry, the orphan is rewritten in place instead of double-posting.

#### Added — Memory-grounded chat replies with citation chips · `KAIROS` · `UI`
- Every reply pulls the anchored Dominion's live cortex doc, all live archetypes, and the top-5 FTS substrate hits over the last 90 days. They flow into the system prompt as a grounded context block.
- Inline `[[uuid]]` citation tokens render as small purple chips bearing the source memory's title (truncated, hover-expand). Tokens the model invents (ids not in the retrieved set) render as a muted **?** so confabulation is visible at a glance.
- A dim **Reading: cortex · N archetypes · M memories** line sits above each assistant bubble so you can see what was grounding the answer.
- Falls back cleanly to bare chat when a Dominion has no cortex yet — newly-created Dominions are still usable on day one.

#### Added — Nightly Dominion synthesis (archetypes + cortex) · `KAIROS` · `DATA` · `INFRA`
- **Archetype generator** (02:30 UTC): per-Dominion BYOK heavy-tier pass over the last 14 days of substrate + all reflections, emitting 3–7 master themes. Prior batches are soft-archived so "live archetypes" always equals today's run.
- **Cortex regen** (03:00 UTC): one living document per Dominion, regenerated nightly from those archetypes + reflections + Dominion vision. Acts as the system-prompt prefix when you chat anchored to that Dominion. Old cortex rows are kept as historical record — scrub backwards to watch the brain change.
- Both are gated by your BYOK heavy-tier key. No key wired for a Dominion → the synthesis skips that Dominion cleanly.

#### Added — `kairos_reflect` MCP tool — owner reflections from any Claude session · `KAIROS` · `MCP`
- New MCP tool: `{dominionId, body, tags?}` captures a reflection into the anchored Dominion. Stored with `streamClass='reflection'` and weighted **higher** than any other class in synthesis prompts — reflections can override drift signals and are never archived by compaction.
- Use `list_dominions` to find the target id, then `kairos_reflect` to fire. Designed for fast quick-fire capture from any Claude Code session — no UI, no friction.

#### Added — Three-layer memory classification (`streamClass`) · `DATA` · `KAIROS`
- New `streamClass` field on every memory: `reflection` (highest weight, owner signal) / `idea` (manual notes) / `agentic` (Claude sessions, agent output) / `execution` (board imports, cron snapshots) / `archetype` (synthesised master nodes) / `cortex` (living Dominion doc).
- All 378 existing memories backfilled via a source+type cascade. The Briefer, synthesis prompts, and chat retrieval all weight by class.

#### Added — Memory hygiene cron + quality gates · `KAIROS` · `INFRA` · `DOCS`
- Weekly memory-compaction cron (Sun 03:00 UTC) — Phase 1A scaffolded in counts-only mode; Phase 1B will absorb stale execution-class memories into archetypes and soft-archive the originals. Pinned + reflection-class rows are never archived.
- New `docs/kairos/14-quality-gates.md` documents what enters/leaves the brain, the memory↔board boundary, cross-user isolation rules, Dominion lifecycle, and reflection weighting.

#### Added — Dominion backfill — every memory now has a home · `DOMINION` · `DATA`
- Phase 1A cascade-backfilled `dominionId` across the substrate (project → repo → fallback). 98% of memories landed; the 5 unanchored are a cross-user cron-leak symptom that's now tracked as a separate audit item.

#### Changed — Briefer now reads live board state · `KAIROS` · `DATA`
- The 7 a.m. daily briefer no longer relies on a bulk-imported snapshot of every card. It now queries the board directly via `inspectDominion()`'s board-task join, so the advisory always reflects what's actually on the boards right now.
- The bulk-import script that previously mirrored every card into the memory layer is deprecated behind a tripwire env flag — the board owns cards, the brain owns synthesis, no double-write.

#### Changed — MCP tool count: 94 → 95 · `MCP`
- +1 in **kairos** (`kairos_reflect`).

#### Migrations required
- `0021_memory_stream_class.sql` — adds `stream_class` to `memories` with the source+type cascade backfill.

### From app 0.11.0, 30/05/2026

> Areas touched: `KAIROS` `DOMINION` `UI` `MCP` `API` `DATA` `AUTH` `BOARD` `DOCS`
> Theme: Kairos becomes a daily companion — auto-capture, daily briefer, advisory feed, agent spawn — gated by your own AI keys. Sidebar gets a Home entry, the dashboard stops shouting at you, and the AI key page is rebuilt in product voice.

#### Added — Daily Briefer · `KAIROS`
- A 7 a.m. cron writes one advisory per active Dominion using your BYOK heavy-tier model. The advisory is anchored to that Dominion and idempotent — running twice on the same day is a no-op.
- The Daily Briefing card has three explicit states: no key wired → CTA, key wired but no advisory today → manual **Run now**, advisory present → render with provider pills in the header.

#### Added — Daily Briefing + EOD Reflection as sidebar popovers · `UI` · `KAIROS` — split: public bullets stayed in the app changelog
- Both have moved out of the auto-pinned dashboard slot. The dashboard now opens directly on your realms.
- Sun icon = Daily Briefing popover. Moon icon = End-of-Day reflection (three fields: what happened, what did I decide, what's still open; idempotent per day, day-resets after midnight).
- Both share a new `AnchoredPopover` primitive that flips below the trigger when there isn't room above and closes on Escape.

#### Added — Advisory feed (ambient sidebar) · `KAIROS`
- Sparkle icon in the sidebar shows an unread count. Popover lists the last 3 days of advisories with acknowledge (soft-archive) and `open →` deep-link to the memory in Kairos.

#### Added — Auto-capture (board + project events) · `KAIROS` · `DATA`
- Task and project mutations now fire-and-forget into the memory layer (created, updated, moved, completed, deleted). The Notes bento and Kairos graph populate themselves as you work.
- A nightly project-snapshot cron writes one memory per project per day: open / done / blocked counts plus the last 5 events.

#### Added — Kairos Spawn primitive · `KAIROS` · `API` · `DATA` · `MCP`
- New `agent_sessions` + `session_events` tables and `apps/kairos-worker/` — a standalone Node HTTP service that shells the Claude Code / Codex CLI on your behalf.
- Live Sessions button in the sidebar shows running sessions with a pulsing badge, a transcript that polls every 2 s, and a kill switch. Full REST (`/api/v1/sessions/*`) and MCP (`spawn_session`, `list_sessions`, `get_session`, `list_session_events`, `kill_session`) parity.

#### Added — Notes bento page (`/notes`) · `KAIROS` · `UI`
- Pinterest-style grid of memories with today's auto-capture strip up top, a neighbours panel that re-seeds on any linked memory, and **Promote to Card** (convert a memory into a board task).

#### Added — Home entry at the top of every sidebar · `UI` — split: public bullets stayed in the app changelog
- Bottom pill row reorganised: top cluster = today (Notes / Briefing / Advisories / EOD / Live sessions); bottom cluster = utilities (Changelog / Beta features / Help / Stats / Settings).

#### Added — Dominion editor + creator · `DOMINION` · `UI`
- **New Dominion** sidebar action opens a glassy creation modal (name, color, icon).
- Dominion edit drawer lets you inline-edit vision, long-form mission, objectives (status + target date), and the visual treatment.

#### Changed — `/notes` and `/settings/ai` now wrap in the standard sidebar shell · `UI` — split: public bullets stayed in the app changelog
- Previously rendered bare — both pages now show the same sidebar as the rest of the app, with a working Home entry.

#### Changed — MCP tool count: 76 → 94 · `MCP`
- +16 in **dominions** (CRUD, vision, objectives, repo mapping, project assignment, bulk assign), +5 in **sessions** (spawn, list, get, events, kill). Realms grew +3 (members + invites). Total now 14 categories.

#### Fixed — Help / Stats / Settings modals no longer get overlapped by Kairos node labels · `UI`
- Bumped from `z-50` to `z-[200]` so the 3D graph's planet labels (drei `Html zIndexRange={[100,0]}`) sit below them. Same fix as previously applied to the changelog + features modals.

#### Fixed — EOD reflection's "already today" flag persisted across midnight · `KAIROS`
- A tab left open overnight kept showing yesterday's status. The flag now invalidates when the captured day no longer matches today's tag.

#### Fixed — Daily Briefing card no longer crashes on a corrupt cache entry · `KAIROS`
- Each cached advisory is shape-checked on parse; mismatches trigger a clean refetch instead of throwing inside the markdown renderer.

#### Fixed — Briefing provider pill no longer flickers · `KAIROS` · `DATA`
- When the heavy-tier preference isn't wired, the fallback active provider is now picked from a deterministically ordered credential list (was undefined Postgres row order).

#### Migrations required — split: public bullets stayed in the app changelog
- `0017_dominion_body.sql` — vision / mission / objectives on `dominions`; `dominion_objectives` table.
- `0018_engine_policies.sql` — `engine_policies` for routing overrides.
- `0019_agent_sessions.sql` — `agent_sessions` + `session_events`.

### From app 0.10.0, 23/05/2026

> Areas touched: `KAIROS` `DOMINION` `MCP` `API` `DATA` `UI` `DOCS`
> Theme: Kairos K-0 through K-5 complete. 2D WebGL graph with cross-repo connections via Dominions, memory backfill tool, in-app onboarding modal.

#### Added — Kairos 2D WebGL graph · `KAIROS` · `UI`
- Orthographic Three.js scene via `@react-three/fiber` + `d3-force-3d`. Orthographic camera controls, planet-cloud node rendering, real edge lines, starfield backdrop.
- Color modes: by **Dominion**, by type, by realm, by recency.
- `MemorySidePanel` renders the AI-cleaned title + execSummary bullets when a node is selected.
- Cross-repo edges now appear automatically when memories share a Dominion.

#### Added — Dominions (top-level grouping above project) · `DOMINION` · `DATA` · `MCP`
- New tables `dominions` + `dominion_repos`. `projects.dominion_id` and `memories.dominion_id` foreign keys added.
- Dominion resolves for a memory in this order: explicit `memory.dominion_id` ?? owning `project.dominion_id` ?? `dominion_repos` lookup via `sourceMetadata.repo` ?? Unassigned.
- 10 new MCP tools: CRUD + `add_dominion_repo` / `remove_dominion_repo` / `assign_project_dominion` / `bulk_assign_projects_to_dominion`.
- REST surface for Dominions is **not yet built** — flagged as known gap.

#### Added — `list_memories_needing_summary` MCP tool + REST mirror · `MCP` · `API`
- Returns memories with empty `execSummary` (and/or null `aiTitle`) so the caller can backfill them via `update_memory` in a loop.
- REST mirror at `GET /api/v1/memories/needs-summary`.
- Memory parity test now locks 7 MCP tools against 9 REST routes.

#### Added — Kairos Setup + Guide modal · `KAIROS` · `UI`
- Glowing pill in the sidebar (between realm list and create actions) opens a two-tab onboarding modal.
- Setup walks new users through MCP configuration; Guide is the usage reference.

#### Fixed — 2D edges now render after the first d3-force tick · `KAIROS`
- d3-force mutates `link.source` / `link.target` from string IDs to node refs after the first tick. The renderer was doing `nodeById.get(string)` every frame and the lookup quietly returned undefined. One-line guard added.

#### Changed — `ARCHITECTURE.md` and `VISION.md` refreshed · `DOCS`
- MCP tool count bumped 63 → 76. K-0 through K-5 marked complete. K-6 (Dominion REST + bulk-assign UX) and K-7 (BYOK merge) added.

#### Migrations required
- `0015_kairos_summaries.sql` — adds `ai_title varchar(120)` and `exec_summary jsonb default []` to `memories`.
- `0016_dominion.sql` — creates `dominions` + `dominion_repos`, adds `dominion_id` to `projects` and `memories`.

### From app 0.9.0, 22/05/2026

> Areas touched: `KAIROS` `DATA` `UI` `MCP`
> Theme: Brain → Kairos rebrand, memory display rework, AI-cleaned title + exec summary schema.

#### Changed — Brain → Kairos rebrand · `KAIROS` · `UI` · `DOCS`
- All paths and references: `app/brain/` → `app/kairos/`, `components/brain/` → `components/kairos/`, `docs/brain/` → `docs/kairos/`. Route is now `/kairos`.
- Sidebar header animates `AEON : KAIROS` with a pulsing glow when on the Kairos route.

#### Added — Memory schema for AI-cleaned display · `DATA` · `MCP`
- `memories.aiTitle` (varchar 120, nullable) — 1–6 word AI-cleaned title for front-of-house display.
- `memories.execSummary` (jsonb default `[]`) — 5–10 bullet array.
- `create_memory` and `update_memory` MCP tools accept and return both fields.
- The Aeon server does **no LLM work** — all summarisation happens at the call site (Claude Code self-cleans, then sends pre-cleaned payload).

#### Added — `MemorySidePanel` rework · `KAIROS` · `UI`
- Title + colour pills + execSummary bullets + collapsed body. Graceful empty-state for memories that pre-date the schema.
