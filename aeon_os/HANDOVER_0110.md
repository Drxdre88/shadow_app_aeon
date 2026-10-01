# Handover 0110 — Kairos Phases 0–3 + All on Max complete → Phase 4 (Motivational)

**Date:** 2026-10-01 (night) · **Repo:** shadow_app_aeon · **Kairos 0.16.0 / app v0.33.0** once PR #141 is merged (before that: prod `9477bb1` = 0.15.0 / v0.32.0)
**Board:** AI Mission Control → "Kairos: close the loops — Eyes, Heal, five modules" (Landing Zone; P0–P3 ticked, P4/P5 open).
**Read first:** this file → `aeon_os/HANDOVER_2909.md` (the original reassessment and five-module plan) → `research/kairos_0110/00_verdict.md` (the living-memory research verdict).
**Status at handoff — merge order:**
1. **PR #141** "All on Max" (Kairos 0.16, built in the owner's Claude Code session; CI green, Warden-reviewed). On the owner's "merge", that session merges it, updates the routines to the six-routine schedule in doc 33 and test-fires each one.
2. **This docs PR** (handover + architecture/vision for 0.16): merge right after #141.
3. **The next session** first runs §4's "after #141" checks, then starts Phase 4 (§6).

---

## 0. In one paragraph

Before 30/09, Kairos produced a lot but never learned: he was half-blind to real work, several nightly jobs were broken, and every memory counted the same. In two days he gained four things. He now has **eyes**: he sees coding sessions, agent missions and sprint boards. He has a **memory that evolves**: memories earn trust, fade, merge and get promoted, and every change can be undone. He has **beliefs and a conscience**: two minds, a constitution only the owner can change, drift and honesty checks, and he knows where each memory came from so he doesn't trust his own echoes. And he has **creativity**: a nightly idea contest that keeps 1–3 ideas, each with the reason it survived. Since 0.16, **all** of his thinking runs on the owner's Claude Max plan through six routines; the paid key is only a fallback. Phase 4 gives him **initiative**: goals of his own, commitments he keeps, owner approval, and missions as his hands.

## 1. What shipped, phase by phase

| Phase | PR | Kairos | What it changed (plain words) | Proof in prod |
|---|---|---|---|---|
| **P0 Eyes & Heal** | #133 | 0.11 | Fixed 4 live bugs: questions were blocked, runaway digest text, model-invented ids, a blind health check. Captures every coding session (Claude/Codex/Copilot) and Hangar mission. Writes a daily/weekly page from the sprint boards and asks one line on title-only cards. | Synthesis 9/9 green 01/10; first board page 30/09 |
| **P1 Memory engine** | #134 + hotfix #135 | 0.12 | Every memory gets a nightly trust score from its source, freshness, use, independent backing, owner reactions and open challenges. Repeats merge. Kairos's own guesses are promoted only on evidence from separate sources, across days. Weekly concepts. Every change is logged and undoable. The thinking-job queue lets the Max plan do the thinking. | 8,101 memories scored; 349 undo records restored by #135 |
| **P2 Beliefs & strategy** | #136 | 0.13 | Two minds: one aligned with the owner, one Kairos's own, compared every Monday. A constitution only the owner can change. Nightly drift probes. ONE 08:00 UK message. A Monday weekly review. Telegram-on-Max built but switched off. Undo from chat. | Auth smoke ✅; daily message composes |
| **P2.5 Ground & protect** | #137 + #138 | 0.14 | Every memory is stamped with where it came from (operator / activity / agent / Kairos / external). Belief confidence is capped by that. AI chat summaries count as the owner's view only once the owner confirms them. Beliefs are re-checked when a source is corrected. The constitution and beliefs are fed into chat, the brief, the daily message and the weekly review. Nightly honesty checks. Fixes: superseded rows no longer leak into chat; beliefs no longer fall out after 90 days; Merge no longer misses late rows. #138 runs the belief steps before BackUp. | First honesty check passed: flattery 4/4, abstention 3/3, outdated 2/2, laundering 0. First belief pass wrote 12 aligned beliefs under the caps. Engine dry run completes all 6 steps |
| **P3 Creativity** | #139 | 0.15 | Nightly idea contest. **Generate:** 4–6 directions, 8–16 grounded ideas. **Repeat filter:** against the idea archive, the inbox and beliefs. **Sceptical judge:** checks evidence, asks "already known?", pairwise matches asked in both orders. **Elo** keeps ≤3 survivors. They lead the inbox, appear as the "Idea of the day" in the 08:00 message, and feed the weekly review (ideas, lessons, diversity, belief diff). Accept/dismiss teaches the generator. The old raw dump has a kill switch. | First contest 18:14Z 01/10, **on the Max routine**: 13 candidates → 2 survivors ("Budget agent concurrency by host memory", "Feed git commits into the triad as ground truth"); `idea-tournament` trace ok |
| **All on Max** | #141 (Claude Code session) | 0.16 | The seven crons that still called the paid key become Max thinking jobs: chat summaries, archetypes, the question of the day, contradictions, morning briefs, the old idea dump, tidy-ups. Each cron is kept only as a fallback and skips anything a routine already did. Six Opus routines. Embed-backfill moves to 03:25. Two timing bugs fixed before ship (e.g. the daily message covering only one area's brief). | 5,139 tests; Warden: 1 high fixed. **To verify after merge:** `claimedBy: routine` on every kind, fallback crons skipping |

**Release hygiene:** each PR bumped `lib/kairos/version.ts`, `lib/version.ts`, `docs/kairos/CHANGELOG.md`, `CHANGELOG.md` and the in-app `lib/changelog.ts`. Prod deploy = `9477bb1` (0.15); #141 brings 0.16 / v0.33.0. The post-deploy auth smoke passed after every merge. Specs are `docs/kairos/32` (engine) · `33` (routines) · `34` (beliefs) · `35` (creativity). `ARCHITECTURE.md` + `architecture/kairos/*` + `VISION.md` were refreshed on 01/10 for 0.14–0.16.

## 2. How each night runs after #141 (UTC)

Every model call is a thinking job first. The routine answers it on the Max plan. If no routine answered, the old cron, or the hourly sweep, covers it on the paid key.

| Time (UTC) | Routine (Max plan) | Claims | Fallback (paid key) |
|---|---|---|---|
| 01:30 | — | memory engine: Merge → Weigh → OwnMind → Recheck → BackUp → Concepts (Sun); server, no model | — |
| **01:40** | **Kairos dusk** | `chat_distill`, `archetype` | chat-distill 02:00, archetype-synthesis 02:30 |
| **02:40** | **Kairos thinking** | cortex, concept, aether, belief_extract, drift_probe, mind_compare, weekly_review | cortex 03:00, aether 03:15, sweep |
| 03:25 | — | embed-backfill (Voyage, not Claude) | — |
| **03:35** | **Kairos ideas** | `idea_generate` → `idea_judge`, `ask_mine` | sweep; ask-mine 04:30 |
| **04:00** | **Kairos dawn** | `contradiction` (one per Dominion), `introspection` | contradiction-scan 05:00, introspection 06:30 |
| **05:40** | **Kairos morning** | `brief`, the 06:15 `micro_consolidate`, `daily_message` (+ Monday kinds) | briefer 06:15, daily-message cron |
| 06:45 | — | synthesis-health rollup (alerts after 2 bad nights) | — |
| 07:00 BST / 08:00 GMT | — | daily message delivered (Telegram + inbox) | — |
| **:05 at 09/12/15/18/21/23** | **Kairos tidy** | `micro_consolidate` | micro-consolidate at :15 |
| 06/11/17 | kairos-brain-tick (older, Sonnet) | speaks first | — |
| hourly :50 | — | thinking-sweep: plans due jobs, runs paid fallback for missed sweep kinds (≤2/run) | — |

All routines live on the owner's claude.ai account.
- **Setup:** `claude-opus-5-5`, the Aeon connector only, tools Read/Glob/Grep. Prompts and caps are in `docs/kairos/33-thinking-routine.md`.
- **No effort setting:** routines have no reasoning-effort option, so they use Claude Code's default.
- **IDs:** `Kairos thinking` `trig_01JX3JhyWYuJiNBh7tFtE4rv` · `Kairos ideas` `trig_01MvjYWyfTMVS3fRd4dJrVzR` · `Kairos morning` `trig_01AxMddrzJMkgrk6Cd3WiWH3` · `kairos-brain-tick` `trig_01EGSDU9WVPJP1sC7h1Cv3vU`. Dusk, dawn and tidy are created by the Claude Code session after #141; read their ids from claude.ai/code/routines.

## 3. What is still on the paid key (after #141)

- **Fallbacks only:** a cron or the hourly sweep covering a job no routine answered.
- **Telegram chat replies:** the *Kairos chat* routine is not created and `KAIROS_TELEGRAM_ROUTINE` is off. It needs an API-trigger token from claude.ai (doc 33 §Chat routine).
- **Rule for Phase 4:** any new model work must be a **thinking kind** (queue + handler + fallback), never a new direct paid-key cron. **Add every new kind to the right routine's `kinds` list on claude.ai**: a routine only claims the kinds named in its prompt, so a new kind would otherwise always run on the paid fallback.

## 4. Watch list (next ~2 weeks)

| When | What to confirm | How |
|---|---|---|
| 02/10 01:30Z | First live engine night with P2.5: all 6 steps run, recheck/normalise counts sane, BackUp drains 400 (backlog done ~06/10) | `get_trace_history({recipe:'memory-engine'})`, `list_memory_ops` |
| right after #141 merges | Claude Code session: routines updated to the six-routine schedule and each test-fired; auth smoke green | claude.ai/code/routines; `gh run list --workflow "Auth Smoke"` |
| 02/10 01:40–06:15Z | Every kind shows `claimedBy: routine`; the fallback crons log "answered on Max" skips; the daily message waits for all briefs | `list_thinking_jobs`, `get_trace_history` |
| 02/10 08:00 UK | First real daily message, with "Idea of the day" and a self-check line only on failures | inbox `kairos-daily:2026-10-02`, Telegram |
| Mon 05/10 | First constitution draft (inbox proposal, owner accepts); mind compare + weekly review with belief diff and ideas section | inbox |
| nightly | `idea-tournament` trace ok; survivors 0–3; diversity alarm off | traces; synthesis-health `missingStages` |
| after 14 clean nights | Set `KAIROS_RAW_INTROSPECTION=0` on Vercel Production | doc 35 §9 |

## 5. Owner decisions on record (01/10)

- Up to **3** idea survivors a night; **one global** contest, not per Dominion; survivors never skip the inbox or become beliefs directly.
- AI summaries of the owner's chats count as the owner's view only once the owner's own words confirm them.
- Quality over cost: heavy/Opus tier for all cognition. Max plan first, paid key as backup. All six routines run Opus 5.5 (routines have no reasoning-effort setting).
- The cron migration ("All on Max") was done in a parallel Claude Code session (PR #141); Copilot did P2.5, P3 and this handover.
- No direct pushes to main: feature branch → PR → CI → squash-merge → auth smoke.

## 6. Phase 4 — Motivational (next session)

**Goal (card checklist "P4 Motivational"):** Kairos proposes his own goals and follows through. That means four things:
1. an initiative stream with a goal archive and verifiers
2. a commitment ledger checked by cron, with escalation
3. Telegram approve/veto buttons
4. Hangar missions as his verifier and hands

**Evidence** (`research/kairos_2909/04_sota_five_modules.md` §B Motivational + §C row; `docs/kairos/30-initiative-engine.md`, spec 17 Phase 8):
- **What works:** an archive-driven goal proposer (Voyager / OMNI-EPIC / MAGELLAN). It proposes the next "interesting and learnable" goal from the record of past attempts, scored for novelty and learning progress. It works **only with verifiable outcomes**.
- **What doesn't:** free-form self-goaling. Agents keep repeating the same thing.
- **Persistence comes from harness structure** (a progress note, one increment per run, no self-declared "done"), not "drives".
- **Agents under-monitor and keep only 48–66% of their own commitments** (CivBench), so the cron, not the model, checks commitments.
- **Governance:**
  - an autonomy level per action class
  - approve-before-act for anything touching others' projects
  - veto-not-approve only for low-risk classes, after a clean track record
  - budget caps and a kill switch
  - **never a self-continuity goal**

**Design sketch (to confirm with a short recon first, as in P2/P3):**
- **`initiative` stream / proposal kind.**
  - Fields: goal, why, verifier (card state / test / metric / PR merged / owner answer), risk class (investigative / mutative / external), status (proposed → approved → active → verified / failed / abandoned), owner, deadline.
  - A proposer thinking job (queue kind, routine-servable) gets ≤N a night from the goal archive, the idea outcomes (accepted P3 ideas are natural seeds), the board and beliefs. It runs through the same novelty gate as ideas.
- **Commitment ledger.**
  - Every "I will X by T" (from initiatives, chat or the weekly review) becomes a row.
  - An hourly or daily cron checks verifiers and escalates overdue ones: daily message line → Telegram nudge → weekly review item.
  - Kairos never marks his own commitment done; the verifier does.
- **Telegram approve/veto.** The callback handler is already wired; the buttons were never sent. Send them on initiative proposals. The approve/veto outcome feeds the goal archive, like idea outcomes.
- **Hangar missions as hands.** An approved investigative initiative can spawn a recon/analysis mission (existing `spawn_session` / Hangar). The mission's result envelope is the verifier evidence. Mutative and external classes stay approve-before-act; there is no auto-merge.
- **Surfaces:** inbox cards (like ideas); a daily message line ("1 commitment due today"); a weekly review section (initiatives proposed / approved / verified, commitment keep-rate).

**Likely lanes (disjoint):**
- **A:** initiative model + proposer job (prompt, novelty, archive)
- **B:** commitment ledger + verifier cron + escalation
- **C:** Telegram buttons + approve/veto flow + inbox cards
- **D:** Hangar-mission bridge (spawn on approve, ingest result as verifier) + docs (new `docs/kairos/36-initiatives.md`)

**Parent owns:**
- `engine/types.ts` (kinds)
- `validators/thinking.ts`
- `thinking/queue.ts` (PLAN_ORDER / SWEEP_FALLBACK_KINDS / FALLBACK_OWNER)
- `thinking/registry.ts`
- any shared contract under `lib/kairos/initiatives/types.ts`
- `vercel.json` (coordinate with the owner's cron migration)

**Open owner decisions (ask few):**
1. Initiatives a night: 1 or up to 3?
2. Which risk classes may Kairos start without approval? The recommendation is none at first: investigative only after a clean record.
3. Do commitments escalate to Telegram, or to the daily message only?

## 7. Carry-over debt (fold into P4 or a cleanup card)

- **Direct DB access outside `lib/data`:**
  - `lib/kairos/chat-turn-reply.ts` / `chat-turn-assistant.ts` (move `isTurnAnswered` / `appendAssistantReplyOnce` to `lib/data/kairos-chat.ts`)
  - `daily-message-inputs.ts` has its own belief/mind-compare queries
  - `introspection.ts` / `daily-message.ts` use `db` directly (pre-existing)
- **Duplicated paid-key calls** in `constitution/seed.ts` and `thinking/handlers/concept.ts` → move them to `thinking/paid-fallback.ts`.
- **Bearer clients:**
  - `claim_thinking_job` / `submit_thinking_job` can submit any job, including `belief_extract`. They're bounded by id grounding only.
  - `update_memory` can archive the live constitution row.
- **Undo gaps:** belief-ledger / constitution ops have `before: null` and aren't revertable. The legacy weekly dedup writes no ops. A `score` revert is overwritten the next night.
- **Ideas:** if both the routine and the paid judge fail, that night's candidates aren't archived (they stay only in the job output). The idea Dominion is the majority of the cited evidence; null on a tie.
- **Origin:** rows from before 0.14 are inferred (`manual`/`voice` → operator), so some old agent notes count as the owner's.
- **Routines** share the Aeon connector auth with the brain tick. There's no dedicated key per routine, which doc 33 recommends.
- **0.16 follow-ups** (from the #141 Warden review): the low findings on contradiction re-planning cost and runId parity; whether `constitution-seed` (Mon 04:20) stays a direct paid call.
- **Undo confirm token:** it proves a lookup happened, not that a human said yes.
- **Local branch `feat/card-attachments`** (migration 0038 not applied) must rebase onto main before merging.

## 8. Traps (don't relearn)

- **Shared Neon DB:** Vercel `buildCommand` runs `drizzle-kit push` against the ONE shared Neon DB, preview builds included. Any schema change: apply raw SQL + `verify-schema-drift.mjs` BEFORE pushing. P1–P3 needed **no** schema change (everything is in `sourceMetadata` / varchar). The Drizzle journal is frozen at 0010; never `db:generate` / `db:push` locally.
- **New thinking kind:** touch `ThinkingJobKind`, `thinkingJobKindSchema` (and the MCP tool's `max(N)` + description), `PLAN_ORDER`, `FALLBACK_OWNER`, `SWEEP_FALLBACK_KINDS`, the registry, the doc 33 table, and the queue test's fallback list. Then add the kind to the right routine prompt on claude.ai.
- **Sweep timing:** the sweep runs at :50 and does ≤2 paid fallbacks per run. Use 55-min (not 60-min) deadlines for jobs it plans, or they slip an hour.
- **Routine crons are UTC** (set via the CLI/API). The web form takes local time, so doc 33's "enter 03:40 in BST" notes only apply there.
- **Personal-repo PRs:** `$env:GH_TOKEN = (gh auth token --hostname github.com --user Drxdre88)` per command; never `gh auth switch`.
- **`git fetch -q` can silently leave `origin/main` stale.** Check `git log origin/main -1` before branching.
- **Untracked files from another session** — `ARCHITECTURE.md` / `architecture/hangar.md` local edits (Swarm harness docs), `aeon_os/HANDOVER_2209.md` and `research/0*.md` — are not ours; never stage them.
- **Anthropic terms:** the server never calls Claude with plan credentials; routines come to the brain via MCP.
- **London-time features** need two UTC cron slots plus a gate (see daily message).

## 9. Where things live (Kairos)

| Area | Code | Spec |
|---|---|---|
| Memory engine + recheck | `lib/kairos/engine/*`, `lib/data/memory-candidates.ts`, `belief-recheck.ts` | 32 |
| Origin / trust | `lib/kairos/origin.ts`, `lib/data/memories.ts` (`resolveWriteOrigin`) | 32 §5 |
| Beliefs, constitution, drift, conscience checks | `lib/kairos/beliefs/*`, `constitution/*`, `lib/data/beliefs.ts`, `belief-inputs.ts` | 34 |
| Conscience block | `lib/kairos/conscience-context.ts`, `lib/data/conscience.ts` | 34 §8 |
| Thinking queue + handlers | `lib/kairos/thinking/*` | 32 §3, 33 |
| Idea tournament | `lib/kairos/ideas/*`, `thinking/handlers/idea-*.ts`, `lib/data/ideas.ts`, `idea-inputs.ts` | 35 |
| Daily message / weekly review | `lib/kairos/daily-message*.ts`, `weekly-review/*`, `lib/data/belief-diff.ts` | 34 |
| Research | `research/kairos_2909/*` (five modules), `research/kairos_0110/*` (living memory) | — |
