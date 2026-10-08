# Vorath (formerly Kairos) — One Coherent Mind (0.20 → 0.28)

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [synthesis](synthesis.md) · [chat](chat.md)

State as of **Vorath 0.28.0 / app v0.46.0** (2026-10-06). Plans of record: `research/kairos_0310/next_phase_mind.md`,
`research/vorath_0510/living_dominions.md`, `research/vorath_0510/offpiste_10.md`; release log: `docs/kairos/CHANGELOG.md`
0.20–0.28; operator handovers: `aeon_os/HANDOVER_0310.md`, `aeon_os/HANDOVER_0410.md`. The mind is called **Vorath**
since 0.26; code paths, env vars, pref keys and MCP tool names keep `kairos`.
All paths below are under `apps/web/src/` unless stated.

**Ground rules that hold across every wave**
- **No schema change** 0.16–0.26: new state is `user_preferences` server-owned keys or `memories.sourceMetadata.kind` rows (§5). 0.27 adds migration 0040 (Living Dominions, §4b).
- **Flag-gated, off by default, flag-off byte-identical.** Only the shared "today" log is on by default (`KAIROS_TODAY=0` turns it off).
- **One dial: `KAIROS_LEVEL` 0–3** (alias `VORATH_LEVEL`, `lib/kairos/level.ts`). Every mind switch reads through `mindSwitch()`: its own env var if set (even `0`), else the level's value. 1 = track record + watch-only set (gate, rapport, ask-first, trust, surprise, curiosity, taste, Living Dominions observe) + repo memory and the mission checker (the checker still needs each board owner's switch); 2 = + gate live, initiative, agenda, character check, stage + owner model observe; 3 = everything else live. Never set by a level: `KAIROS_SURPRISE_CONTRADICTIONS`, `KAIROS_DISTILL_DIALOGUES`, `KAIROS_REQUIRE_ROUTINE_SCOPE`, routine/daytime switches.
- **Max plan first.** New thinking runs as routine-claimed jobs; none of the 0.20–0.25 kinds has a paid fallback, except where a pre-existing kind already had one.
- **Measurement-only.** Conscience results, character scores, cold reads and taste never reach a Kairos prompt. Dreams never become memories, evidence or prompt text (`dreams/__tests__/firewall.test.ts`, `life-chapters/__tests__/firewall.test.ts`).
- **Telegram stays first-class** (owner rule 03/10). Triad is an extra, enterprise-internal channel.

## 1. Releases at a glance

| Version / PR | Theme | Default |
|---|---|---|
| 0.20 / #148 | Settle the brain: owner-only constitution, routine-scoped claims, unjudged ideas filed, chat timing; **initiative** (goals, promises, Approve/Veto) dormant | P1 on, P2 off |
| 0.21 / #149 | **One mind everywhere** (shared today log); daytime thinking (`reflect` + `pulse`), track record (predictions), Horae (agenda) | today **on**; rest off |
| 0.22 / #150 | Wave 1: the **stage**, weekly **character check**, **cold read** | off |
| 0.23 / #151 | Wave 2: **surprise** as the engine, **dreams** | off |
| 0.24 / #152 | Wave 3: **creative genius** — idea atlas, Swiss rounds, collisions, anti-sameness, incubation, stepping stones, taste | off |
| 0.25 / #153 | Wave 4: **the art of the moment** — gate, owner model, rapport, trust/ask-first, life chapters | off |
| 0.26 / #160 | **Kairos becomes Vorath** — visible rename, `/vorath` page, `VORATH_*` env alias, `/api/v1/vorath` rewrite | on |
| 0.27 / #161 | **Living Dominions phase 1** — nightly activity score, dormant/pinned areas, one ranked roster, `dominion_members` | off (`KAIROS_LIVING_DOMINIONS`) |
| 0.28 / wave A | **What Vorath knows** (provenance, fix in place, needs-your-eyes, private-topic hold) + **card sorting** (`card_triage`) | view on; hold + sorting off |

## 2. One mind everywhere (0.21)

| Piece | Where | Notes |
|---|---|---|
| Today log | `lib/kairos/today.ts` (`recordToday`), store `lib/data/kairos-today.ts` (`agent_sessions.engine='kairos-today'`, `session_events.kind='kairos_today'`), channels in `lib/data/validators/kairos-today.ts:8` | 36h window, 500 entries; channels telegram / web / triad / mcp / voice / session / ask / inbox / kairos |
| Writers | `chat-today.ts` (owner turns + replies), `dialogue.ts` (Triad), `today-mcp-use.ts` (Claude via MCP, one per client+tool per 15 min), `voice-note-confirm.ts`, `ask.ts`, `proposal-accept.ts` / `proposal-decision.ts`, `speak.ts`, `owner-model/correct.ts` | |
| Readers | chat (`loadChatTodaySection`), 06:00 message (`daily-message-today.ts`), pulse/reflect, `get_kairos_today` / `GET /api/v1/kairos/today` | |
| Daytime thinking | `thinking/handlers/reflect.ts` (08–21 London, deep) and `pulse.ts` (07–22 London, light, notes + stage thoughts only — never speaks) | `KAIROS_DAYTIME_THINKING` |
| Track record | `lib/data/kairos-predictions.ts` (`kairosPredictions`), `predictions/score.ts` (Brier, 90-day window, shown from 5 settled) | `KAIROS_PREDICTIONS` |
| Horae | `lib/data/kairos-agenda.ts` (`kairosAgenda`), `agenda_due` kind | `KAIROS_INITIATIVE` + `KAIROS_AGENDA` |

## 3. Inner mechanisms (waves 1–3)

| Mechanism | Lives in | Flag |
|---|---|---|
| Stage (global workspace: every job posts ≤2 thoughts; top coalitions become "I, now") | `lib/kairos/stage/` (select, ambient, queue-glue, render), `thinking/stage-thoughts.ts`, `kairosStage` | `KAIROS_STAGE` (`observe`→`1`) |
| Character check (weekly blind rating vs constitution + owner-approved voice samples; tone budget) | `lib/kairos/character/`, `thinking/handlers/character-check.ts`, `character_run` + `voice_sample` rows | `KAIROS_CHARACTER_CHECK` |
| Cold read (profile-free second opinion on plan judgements; `<stance>` tag in chat) | `lib/kairos/cold-read/`, `thinking/handlers/cold-read.ts`, `cold_read` rows | `KAIROS_COLD_READ` (`audit`→`1`) |
| Surprise ledger / gate / credit / learning progress / replay / surprise→stage | `lib/kairos/surprise/`, `engine/steps/surprise.ts` (between Weigh and OwnMind), `lib/data/belief-aligned.ts`, `kairosSurprise` | `KAIROS_SURPRISE_*`, `KAIROS_CURIOSITY_LP` |
| Dreams + morning read (firewalled; light tier on the stage; Telegram-only "I dreamt…") | `lib/kairos/dreams/`, kinds `dream`, `dream_read` (output-only storage) | `KAIROS_DREAMS`, `KAIROS_DREAM_LINE` |
| Idea contest extensions | `thinking/handlers/idea-ext/` registry [stepping, atlas, collision, sameness]; `ideas/{atlas,swiss,sameness,stepping}/`, `collision/`, `incubation/`, `kairosIdeaAtlas`, `kairosIdeaShelf` | `KAIROS_IDEA_ATLAS`, `_SWISS`, `KAIROS_COLLISIONS`, `KAIROS_IDEA_VS`, `_RESAMPLE`, `_SHELF`, `_NOVELTY`, `_TASTE` |

Swiss rounds run as follow-on `idea_judge:<day>:r<k>` jobs (no new kind), stop chaining past the 04:35Z settle,
and never use the paid key after round 1. A collision bridge is a `relates` link with a `bridge · idea:` note,
written only on owner/operator accepts.

## 4. The moment seam and wave 4 (0.25)

`lib/kairos/moment/` is a guarded `MomentLane` registry (`types.ts`, `index.ts`), mirroring the wave-3 `idea-ext`
seam. Every hook is wrapped (a failure is logged and skipped); with no lane implementing a hook the runner passes
the input through unchanged. Lane order — also chat style precedence — is **rapport → advise-trust → owner-model → gate → chapters**.

| Hook | Called from |
|---|---|
| `speakPolicy` / `speakDelivered` | `speak.ts` (after caps + forced ceiling; block → 429 `moment_blocked`, hold → row `status:'held'` + `gate` metadata) / after `fanOutSpeak` |
| `sweep` | `app/api/cron/thinking-sweep/route.ts` (operator only; keys added only when non-null) |
| `ownerTurn` / `reply` | `chat-today.ts` (`after()`-detached) |
| `chatContext` / `finishReply` / `stripFooter` | `moment/chat.ts` (`loadMomentChatOptions`, `finishChatReply`, `stripMomentFooters`) used by `chat-turn-assistant.ts`; grounding loaders moved to `moment/chat-grounding.ts` |
| `daily` / `dailyDelivered` | `daily-message-inputs.ts` (`gatherMomentDaily` → openings, prompt blocks, tail) / `daily-message.ts` |
| `telegramText` / `telegramCallback` / `telegramMessage` | `moment/telegram-routes.ts` via the webhook (text after veto-reason, before chat; callbacks after `p1:`, before dismiss/accept; non-text updates) |
| `ownerDecision` | `proposal-accept.ts` (every accept/dismiss path) |

| Lane | What it does | Flags | Code / state |
|---|---|---|---|
| **Gate** | Holds unprompted, non-digest messages until a natural break (chat ended, card closed, session ended, quiet ≥10 min, away ≥3h) or the deadline (default 120 min, released at the next hourly sweep, so ≤ ~3h); learns a receptivity map (hour/day/kind/source/channel, 28-day half-life) — never in a prompt. Flag off flushes held rows at the next sweep. | `KAIROS_GATE`, `_RECEPTIVITY`, `_MAX_HOLD_MIN`, `_QUIET_MIN`, `_CHAT_QUIET_MIN`, `_AWAY_MIN` | `moment/gate/`, `lib/data/kairos-gate.ts` (`kairosGate`, atomic claim on release); `get_kairos_gate` |
| **Owner model** | Lasting traits vs states that lapse 10 days after the owner's last confirmation; live-only fenced block in chat + 06:00; Sunday-evening "what I think you're carrying" card with `om1:` buttons, `C<n> still/over/wrong` / `C<n>: …` commands and a web inbox card. Extracted as a side section of `belief_extract` (Max answers only; stripped on the paid fallback). No MCP/REST write path. | `KAIROS_OWNER_MODEL`, `_STATE_TTL_DAYS` | `lib/kairos/owner-model/`, `lib/data/kairos-owner-model.ts` (`kairosOwnerModel`), `components/kairos/OwnerCarryingCard.tsx`; `get_kairos_owner_model` |
| **Rapport** | Deterministic lexicon at capture (no model calls): readiness per owner `dominion_objectives` (offer one step / reflect), small bids (brief warm reply; one Telegram `setMessageReaction` for sticker/GIF/photo), rupture → back-off (speak 429 unless forced/high) → repair opening (06:00 still sent, repair line first) | `KAIROS_READINESS`, `KAIROS_BIDS`, `KAIROS_REPAIR` | `lib/kairos/rapport/`, `lib/data/kairos-rapport.ts` (`kairosRapport`); `get_kairos_rapport` |
| **Advise / trust** | Ask-first classifier (offer → "Want my take, or would you rather think it out loud?"; listen; advise = questions first, view last). Trust per area recomputed on read from predictions, goals and goal-linked promises (Beta(2,2) + Wilson; levels unknown/check/second/lean) — shown as a reply footer (stripped from history), a Monday 06:00 line and a read view; never in a prompt | `KAIROS_ASK_FIRST`, `KAIROS_TRUST` | `lib/kairos/{advise,trust}/`, `lib/data/kairos-trust.ts`; `get_kairos_trust` |
| **Chapters** | Monthly `life_chapter` kind (UTC days 1–3 from 12:00Z, 36h, no paid fallback): honest turning points with cited ids, loose ends left open; trace row; in mode `1` reflect sees "where your story stands" (≤600 chars, never citable). The moment lane slot is empty. | `KAIROS_LIFE_CHAPTERS`, `KAIROS_LIFE_CHAPTER_LINE` | `lib/kairos/life-chapters/`, `thinking/handlers/life-chapter.ts`, `lib/data/life-chapters.ts`; `get_kairos_life_chapters` |

## 4b. 0.26–0.28: the name, the focus, the visible mind

**Rename (0.26).** `lib/kairos/identity.ts` (`MIND_NAME='Vorath'`, `FORMER_MIND_NAME='Kairos'`). Every persona prompt says
"Vorath (formerly called Kairos; memories that mention Kairos are about you)". `/kairos` permanently redirects to
`/vorath`; `next.config.ts` rewrites `/api/v1/vorath/:path*` → `/api/v1/kairos/:path*`; `lib/env/mind-env-alias.ts`
copies non-empty `VORATH_*` onto `KAIROS_*` at server start (`instrumentation.ts`, nodejs only — the worker and scripts
still read `KAIROS_*`). Kept as kairos: stored keys, tags, kinds, tool names, the `Telegram · Kairos` thread title
(lookup key), drift-probe questions (baselines). Routines are named *Vorath brain/chat/pulse* (renamed in place).

**Living Dominions (0.27).** Focus follows recent activity, not a fixed list.
| Piece | Where | Notes |
|---|---|---|
| Switch | `lib/kairos/living/flag.ts` | `KAIROS_LIVING_DOMINIONS` off · `observe` (score + Health only) · `1` (consumers act); `KAIROS_DORMANT_DAYS` 21 (7–90) |
| Score | `lib/kairos/living/{score,signals,attribution,repo-slug}.ts`, `lib/data/dominion-activity.ts`, cron `dominion-activity` 01:10 | 30-day window, 10-day decay; completed card 3, created 1 (owner) / 0.3 (agent tool), move 0.2, session 2, owner note 0.5; caps 50 card events/board/day, 10 sessions/repo/day; machine memories excluded; unattributed work → `kairosLivingUnattributed` |
| Roster seam | `lib/kairos/living/focus.ts` (pure), `lib/data/dominion-focus.ts` | dormant = `focus_state='dormant' && !pinned`; off/observe byte-identical |
| Consumers (when `1`) | archetype/cortex/concept planning + crons, aether inputs, 06:00 areas (ranked), weekly review (`plan-weekly.ts`), ask-mine (`plan-ask.ts`), idea night + atlas (`plan-ideas.ts`), readiness | dormant skipped, ranked by activity |
| Membership | `dominion_members` (0040), `lib/data/dominion-members.ts` | repo filing by weight; board membership synced on every project Dominion change |
| Surfaces | Health "Where your time went" (`components/kairos/brain/FocusView.tsx`), `get_dominion_focus` / `GET /api/v1/dominions/focus`, `pinned` on `update_dominion` / `PATCH /api/v1/dominions/[id]` | pin keeps an area awake |

**What Vorath knows (0.28).** Header button on `/vorath` → `components/kairos/knows/*` (drawer: beliefs/facts by area,
*Needs your eyes*). `lib/data/memory-knows.ts` + `lib/actions/memory-knows.ts`: provenance (origin in plain words,
source chat/session/card/voice note, standing, belief trail + `memory_ops`), edit in place (operator origin),
"It's right" (re-label operator, `priorOrigin` kept), "This is wrong" (soft archive + `memory_ops` `reject`, undoable).
Constitution and goal rows stay immutable. **Private-topic hold** (`lib/kairos/sensitive/*` — lexicon, capture stamp, one held predicate in `held.ts`; pref `kairosSensitiveGate`
read/written by `lib/data/kairos-sensitive.ts`, key in `sensitive/pref-keys.ts`; default off): deterministic lexicon stamps `sourceMetadata.sensitive/sensitiveHeld/sensitiveTopics` at capture; held rows
are excluded via `validAsOfNow` (+ chat last-24h, one-hop neighbours, 06:00 inputs, ask snippets, dialogue seeds,
belief-recheck evidence) until confirmed; floating dialogue reflections and agent/MCP text edits are stamped too (owner edits never). Owner fixes add
`ownerRejected` / `ownerReviewedAt`.

**Card sorting (0.28).** Thinking kind `card_triage` (25th kind; brain routine, deep tier, no paid fallback):
`lib/kairos/triage/*`, `thinking/handlers/card-triage.ts`, `lib/data/card-triage.ts`, `lib/actions/card-triage.ts`,
`components/board/triage/*`. Per-board `projects.settings.kairosTriage='on'` (creator-only; generic settings patches
can't flip it). Batches ≤10 recent untriaged cards/board, ≤5 boards per pass; fenced card text; labels only from the
board; suggestions in `board_tasks.metadata.triage`, accepted/dismissed per item on the card. The toggle and Accept/Dismiss are app-only by design (no MCP/REST twin): an agent can't switch sorting on or accept its own suggestions.

## 4c. 0.29–0.30: Vorath runs the workforce

Plan: `research/vorath_0610/expansion_plan.md` Phase 1; Vorath consulted 06/10 (decision memory `0fab0987`). Never merges, moves cards to Done, creates cards or writes to a repo. No migration.
- **Repo memory** (`repo_lessons`, `KAIROS_REPO_MEMORY`, level 1): one batched nightly job (01:40–04:28 UTC, ≤6 repos with sessions in the last 24h) turns session-summary memories into a ≤10-lesson playbook per repo (`sourceMetadata.kind='repo_playbook'`, `repoSlug`, externalKey `repo_playbook:<slug>`); every lesson cites source memory ids from its own repo. `lib/kairos/repo-memory/*`, `lib/data/repo-memory.ts`. **Handover on read**: `get_repo_handover` ⇄ `GET /api/v1/kairos/repo-handover` (`lib/data/repo-handover.ts`): Start here + latest sessions, open `repo:*` cards, open asks/promises, playbook; label↔folder aliases in `repo-memory/aliases.ts`.
- **Payback ledger** (read-only, no switch): `get_agent_payback` ⇄ `GET /api/v1/hangar/payback`, `lib/data/payback.ts`, Velocity tab `PaybackPanel`. Caller's own missions only; null cost = unknown; `timeout`/`killed` = "runner died" (owner kills are also `killed` today).
- **Mission checker** (`mission_check`, `KAIROS_MISSION_CHECK`, level 1, plus the creator-only per-board `settings.kairosMissionCheck`): advisory verdict (`looks_done | partly_done | not_done`, reasons, unmet checklist items) in `board_tasks.metadata.hangar.check`; never changes columns. App-only toggle; generic settings patches can't flip it. `lib/kairos/mission-check/*`, `lib/data/mission-check.ts`, `components/board/MissionCheckToggle.tsx`.
- **Goal → card tree** (0.30, `card_tree`, `KAIROS_CARD_TREE`, level 1): `request_card_tree` ⇄ `POST /api/v1/kairos/card-tree` ⇄ "Plan a goal" on the board header (edit access) queue an on-demand job (key `card_tree:<projectId>:<goal hash>`). The handler grounds ≤12 cards (existing labels only, no cycles, no duplicates of open cards) into a pending internal proposal (`lib/data/card-tree-proposals.ts`, expires in 7 days), announced through the shared gated proposal path (`proposal-telegram*.ts`). Only the owner's Approve (`proposal-decision.ts` kind `card_tree` → `lib/kairos/card-tree/decision.ts`) creates cards, labels, checklists and dependencies in one transaction (`createCardTree`, first column), then Chronos lays them out best-effort (`lib/schedule/solve-project.ts`; `solveProject` stays a guarded wrapper). Veto/expiry create nothing. Inbox: `components/kairos/CardTreeProposal.tsx`.
- Known: Hangar's auto-move only matches a column named exactly `Landing`, so AI Mission Control's "Landing Zone" never receives finished missions (unchanged, owner call).

## 4d. 0.31: your judgement (Phase 3) + follow-ups

Vorath consulted 07/10 (decision memory `7867f277`): no new nightly jobs; forecasts never become his predictions; level 2 waits a clean week.
- **Morning cockpit** (read-only, assembled on read): `get_morning_cockpit` ⇄ `GET /api/v1/kairos/cockpit`, page `/vorath/cockpit` (`lib/data/morning-cockpit.ts`, `components/kairos/cockpit/*`). Predictions due, open asks, promises, pending proposals, stale cards, overnight sessions (since 18:00 London), repos with new lessons; ≤8 rows each, held rows dropped, data-framed markdown.
- **Decision journal**: owner-written non-trading decisions with expectation, 50–95% confidence, type and check-by date; D-numbers; settle right/wrong/void in the app or Telegram `D<n> right|wrong|void` only. Store: server-owned pref `kairosDecisions` (single locked writer `lib/data/kairos-decisions.ts`). `log_decision`/`list_decisions` ⇄ `GET/POST /api/v1/kairos/decisions`; entries logged over MCP/REST are "relayed" until the owner confirms and never count toward calibration. Calibration per type reuses predictions' pure `metricsFor`; nothing else in Vorath imports the journal.
- **Card forecasts** (on read, no writes): `lib/schedule/forecast.ts` = later of saved `computedEnd` and now + 30-day column dwell to Done, only for open cards with a due date or estimate; on_track / at_risk (≤2 days) / late / no_due_date, low confidence under 5 moves. `get_card_forecast` ⇄ `GET /api/v1/projects/[id]/forecast`; `ForecastBadge` in `TaskCardBadges`. Never touches predictions or runs the solver.
- **Finish-rate gardener** (`card_garden`, `KAIROS_CARD_GARDEN`, level 2): Mondays, once per ISO week, ≤25 stale candidates (21+ days, editable boards), ≤10 proposals (finish / park / merge / kill), stored like card trees and announced through the gated proposal path. Approve re-checks edit access and does one action in the claim transaction; merge never fuses (link only). App + Telegram only — a test keeps it off MCP/REST.
- **Follow-ups**: Telegram "Q<n> answer" (bare form, mid-message, reply-to) closes asks; move-all / timeline edits refresh card versions (`lib/data/bridge-sync.ts`); finished missions land in "Landing …"/"Tower …" columns; owner kills recorded as `metadata.kill` and counted as "stopped by you" in payback; "Plan a goal" hidden when the user's brain routine hasn't claimed in 26h; handover lessons data-framed; drift probes say Vorath with a fresh `probes-v2` baseline; over-long archetype strings clipped; ask titles clipped to 255 (the 04/10 and 05/10 ask_mine failures).

## 4e. AI DONE (Vorath checks)

Owner request 08/10: he explicitly allowed Vorath to create these cards himself; they land in a review column, never in Done. No migration, no new env var beyond the switch.
- **Switches**: `KAIROS_AI_DONE` (level 1) plus the creator-only per-board `settings.kairosAiDone` (boolean `true` only), toggled as "Vorath checks" in board settings (`components/board/AiDoneToggle.tsx` → `lib/actions/ai-done.ts`). App-only (no MCP/REST twin); generic settings patches can't set it.
- **Job** (`ai_done`, deep tier, brain routine, cadence `daily`, which brain status counts as "today"): one per user per London day (key `ai_done:<London date>`), planned 16:00–17:59 London only when a switched-on board has new sessions; deadline 18:30 London. No fallback: a missed afternoon is skipped. Not in `SWEEP_FALLBACK_KINDS` or `SWEEP_PLAN_SKIP_KINDS`.
- **Inputs** (`lib/kairos/ai-done/gather.ts`): today's session summaries (`listSessionSummariesBetween`, now exposing `taskId`/`projectId`) from core repos (`dominion_repos`, matched via `resolveRepo`/`normalizeRepoSlug`); per board, sessions anchored to one of its cards or cited by an earlier card's `metadata.aiDone.sessionIds` are dropped. Git digests come in as supporting evidence; the board's open and recently done cards (titles, labels, checklist text) are used for dedup. All of it is data-fenced, with S/E/B handles.
- **Owner style** (`prompt.ts`): 1–5-word titles, a short fragment description, one "Checklist" group or 2–4 area/phase groups, items of 1–6 words, ≤6 cards per board. **Grounding** (`ground.ts`): unknown handles, `alreadyOn` cards, cards with no checklist and title repeats are dropped; text is clipped; labels are only existing board `repo:*`/`dom:*` labels.
- **Writer** (`lib/data/ai-done.ts`, imported only by the handler, guarded by a surface test): one transaction per board. It re-checks the switch and edit access, then creates "AI DONE" just before Done (or at the end if there's no Done column). Cards are `todo` with no `completedAt` and every checklist item ticked, plus `metadata.aiDone {v, jobId, day, repo, sessionIds}`. Re-running a job is idempotent per job + title. Afterwards it does `touchProject` + an agent `created` activity per card.

## 5. State added since 0.16

| `user_preferences` key | Module (single FOR UPDATE writer) | Since |
|---|---|---|
| `kairosPromises` · `kairosPredictions` · `kairosAgenda` | `lib/data/kairos-{promises,predictions,agenda}.ts` | 0.20–0.21 |
| `kairosStage` · `kairosSurprise` | `lib/data/kairos-{stage,surprise}.ts` | 0.22–0.23 |
| `kairosIdeaAtlas` · `kairosIdeaShelf` | `lib/data/kairos-idea-{atlas,shelf}.ts` (keys in `lib/kairos/ideas/pref-keys.ts`) | 0.24 |
| `kairosGate` · `kairosOwnerModel` · `kairosRapport` | `lib/data/kairos-{gate,owner-model,rapport}.ts` (keys in `lib/kairos/moment/pref-keys.ts`) | 0.25 |
| `kairosLivingUnattributed` | `lib/data/dominion-activity.ts` (key in `lib/kairos/living/types.ts`) | 0.27 |
| `kairosSensitiveGate` (boolean) | `lib/data/kairos-sensitive.ts` (key in `lib/kairos/sensitive/pref-keys.ts`) | 0.28 |

All are in `SERVER_OWNED_OBJECT_KEYS` (`lib/data/preferences.ts`), stripped from client saves and carried through
theme saves. `kairosPaidBackup` (0.19) is a separate boolean. New `memories` row kinds (`sourceMetadata.kind`):
`goal` (staged proposal), `cold_read`, `character_run`, `voice_sample`, `life_chapter`, `voice_note_summary`; the
internal ones are refused on create/capture (`validators/memory.ts` `INTERNAL_KINDS`).

## 6. Read surfaces added since 0.19 (MCP ⇄ REST parity)

| MCP tool | REST |
|---|---|
| `list_kairos_promises`, `list_kairos_predictions`, `list_kairos_agenda`, `get_kairos_today` | `/api/v1/kairos/{promises,predictions,agenda,today}` |
| `get_kairos_stage`, `get_kairos_surprise` | `/api/v1/kairos/{stage,surprise}` |
| `get_kairos_idea_atlas`, `get_kairos_idea_taste` | `/api/v1/kairos/{idea-atlas,idea-taste}` |
| `get_kairos_gate`, `get_kairos_owner_model`, `get_kairos_rapport`, `get_kairos_trust`, `get_kairos_life_chapters` | `/api/v1/kairos/{gate,owner-model,rapport,trust,life-chapters}` |
| `get_dominion_focus`; `update_dominion` (`pinned`) | `GET /api/v1/dominions/focus`; `PATCH /api/v1/dominions/[id]` (0.27) |

Each pair shares a validator, data function and renderer, with a parity test in `app/api/__tests__/` that also
guards against writer imports.

## 7. Known follow-ups

| Item | Where |
|---|---|
| ✅ Fixed 06/10: night-time goal proposals now go through the gate (held rows released with their buttons) | `proposal-telegram-gate.ts`, `gate/release.ts` |
| A held message would lose extra Telegram buttons on release (no current caller) | `speak.ts` hold path |
| Dream seeds into ideas deliberately not built (conflicts with the firewall rule) — owner call | plan §4 vs handover §6 |
| Butcher splits: `KairosInbox.tsx` (649), `daily-message-prompt.ts` (500), `ask-mine.ts` (519), `weekly-review/inputs.ts` (620), `cortex.ts`, `memories.ts` (2,392), `projects.ts` (558), webhook route test | — |
| Private-topic hold not applied by readers that bypass `validAsOfNow` (some prompt readers) | `lib/data/{recipes,dialogue,ask,voice-notes}.ts` and others |
| Living Dominions phase 2: Approve/Reject/Rename proposals for unattributed work | `research/vorath_0510/living_dominions.md` §3 |
| Triad bridge `prompt.py` should render `today` and `stage` | Triad repo |
