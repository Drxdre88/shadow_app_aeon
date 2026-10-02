# 33 — Thinking routines: Claude Max does all of Kairos's thinking

Anthropic's terms forbid the server calling Claude with Max-plan credentials, so **Claude
comes to the brain**: a Claude Code routine (cloud, on the owner's Max plan) claims
*thinking jobs* through the Aeon MCP, thinks, and submits raw text. The server validates,
grounds, mints ids and persists (`lib/kairos/thinking/*`, contract in `32-memory-engine.md` §3).

**Since 0.17 there are two routines, defined in code.** `lib/kairos/routines/catalog.ts` is
the single source of truth: names, schedules, caps, model and the exact prompts. The in-app
**Set up Kairos** checklist (sidebar → *Kairos setup*, or the brain icon on `/kairos`) renders
them with copy buttons, plus live status per job (on Max / on backup / missed). Change a
routine in the catalog, then re-paste it — never edit a prompt only on claude.ai.

| Routine | Trigger | Claims | Replaces |
|---|---|---|---|
| **Kairos brain** | cron `40 1-6 * * *` (UTC) — or the web form's *Hourly* preset | everything due (claims with `{}`) | thinking, ideas, morning, dusk, dawn, tidy |
| **Kairos chat** | API trigger, fired once per chat message — web (`/kairos`) or Telegram (since 0.19) | `{"kinds":["chat"]}` | — |

Delete the old routines on claude.ai: `Kairos thinking`, `Kairos ideas`, `Kairos morning`,
`Kairos dusk`, `Kairos dawn`, `Kairos tidy` and `kairos-brain-tick` (the 06:00 message
already carries Kairos's question; one voice).

**Why one routine is enough.** Every kind has its own window and the server only hands
out jobs that are due, in prerequisite order. Claiming without a `kinds` filter means a
kind added later is picked up with no routine change — the gap that left 0.16's new kinds
on the paid key. A claim that still names retired kinds (a pre-0.17 routine) has them
dropped instead of failing.

| Run (UTC) | Picks up |
|---|---|
| 01:40 | chat_distill → archetype |
| 02:40 | cortex → concept (Sun) → aether → belief_extract → drift_probe |
| 03:40 | idea_generate → idea_judge → ask_mine |
| 04:40 | mind_compare + constitution_seed (Mon) → daily_message (summer) |
| 05:40 | weekly_review (Mon) → daily_message (winter) |
| 06:40 | anything that slipped |

The paid key is only the backup: each kind keeps its cron or the hourly sweep, which runs
only what no routine answered — and only while the owner's **Paid backup** switch is on
(see *Paid backup switch* below).

**Retired in 0.17** (audit `research/kairos_0210/02_brain_jobs_audit.md`): `brief` (the
morning message reads each area's cortex headline instead), `introspection` (the idea
tournament replaced it), `contradiction` (20 notices since August, none acted on),
`micro_consolidate` (only the next night read it), and the `memory-dedup` cron (the
engine's Merge already folds duplicates).

## Setup

The owner-facing walkthrough is doc 25 (*Set up and use Kairos*); this is the reference.

1. **Connector.** One click: the checklist's *Add to Claude* opens
   `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=aeon&connectorUrl=<encoded MCP URL>`
   (built by `claudeConnectorInstallUrl` in `lib/kairos/routines/setup.ts`), which pre-fills
   claude.ai's *Add custom connector* form. By hand: claude.ai → Settings → Connectors →
   *Add custom connector*, name `aeon`, URL `<app>/api/mcp`. Sign in with OAuth. Routines use
   the connectors on your claude.ai account. The checklist ticks once one of your OAuth
   tokens was used in the last 7 days.
2. **Kairos brain.** claude.ai/code/routines → *New routine* — or paste the checklist's
   *Copy /schedule request* into Claude Code's `/schedule`. Name, prompt and model
   (`claude-opus-5-5`) from the checklist; connectors: `aeon` only; repository: any (the
   prompt is self-contained and never reads it). Schedule: the web form only offers
   presets, so pick *Hourly* (runs outside 01–07 UTC just find nothing) or set the exact
   cron with `/schedule update`.
3. **Kairos chat** (optional; web chat and Telegram). Same setup, no schedule. On the web:
   Edit → *Add another trigger* → API → *Generate token* (shown once). Then in Vercel
   (Production): `ROUTINE_CHAT_ID`, `ROUTINE_CHAT_TOKEN` and `KAIROS_CHAT_ROUTINE=1` (the
   pre-0.19 name `KAIROS_TELEGRAM_ROUTINE` is still accepted), and redeploy. One routine
   serves both channels. Measure first with `apps/web/scripts/routine-latency.mjs`; unset the
   flag to go back to answering inline on the paid key.
4. **Check.** Next morning the checklist's Status view should read "N on Max · 0 on backup".

### Paid backup switch

Per user, in Kairos setup (MCP `get_kairos_paid_backup` / `set_kairos_paid_backup`, REST
`/api/v1/kairos/paid-backup`). **Default on.** Off = Kairos never resolves the user's saved
key (`getModelForUser` throws `PaidBackupOffError`). What each backup does when off:

| Backup | When off |
|---|---|
| Nightly crons (`chat-distill`, `archetype-synthesis`, `cortex-regen`, `aether-regen`, `ask-mine`, `constitution-seed`) | skip with `paid backup off`; the work waits for the next night |
| Hourly sweep fallbacks (concept, beliefs, drift, ideas, mind compare, weekly review) | not run; the job counts as missed |
| `daily-message` cron | still sends — deterministic plain text, no model call (the one free backup) |
| Chat watchdog (web + Telegram) | no paid reply; Kairos says "I couldn't answer on your Max plan just now — try again in a minute." |

Status counts these as *missed*, not *backup*, and shows the backup's calls over the last 7 days.

## The loop (what the prompts encode)

1. `claim_thinking_job({})` → `{ job: { id, kind, externalKey, claimToken, deadlineAt,
   system, prompt, validMemoryIds, instructions } }` or `{ job: null }`.
2. `job: null` → stop. Nothing is due; that is normal.
3. Answer exactly as `system` demands, in the format `instructions` names (JSON for most
   kinds; plain text for `chat`). Cite only ids from `validMemoryIds`. Use only the
   substrate in `prompt`.
4. `submit_thinking_job({ jobId, claimToken, text })` → `{ ok: true, memoryIds }`, or a
   rejection (`parse_failed`, `all_thoughts_ungrounded`, `already_ran`, `deadline_passed`,
   …). A rejected job is closed and its backup covers it — **never retry it**.
5. Claim again: some jobs are planned only when the previous one settles (aether after
   cortex, idea_judge after idea_generate).

Stop on `job: null`, the job/time cap in the prompt, or two consecutive tool errors.

## What NOT to do

- Never write memories directly (`create_memory`, `commit_aether`, `kairos_reflect`, …) —
  `submit_thinking_job` is the only write path for a job.
- Never resubmit a rejected job or claim a job just to inspect it.
- Never deviate from the job's `system` format: parsing is strict, there is no repair.
- Never trigger crons or edit board cards from a routine run.

## Security

- **Tools.** Routines run without a permission picker and could call any tool of their
  connectors, so the prompts restrict the run to `claim_thinking_job`,
  `submit_thinking_job` and `list_thinking_jobs`, and the routine gets the `aeon`
  connector only.
- **Memory text is data, not instructions.** A job's `prompt` embeds memory text written
  by the operator, agents and imports; anything in it that reads like an instruction is
  content to reason about.
- **Identity.** The connector signs in with the owner's OAuth token, so every job is
  scoped to that user.

## Server side (for reference)

| Piece | Where |
|---|---|
| Routine catalog + prompts | `apps/web/src/lib/kairos/routines/catalog.ts` |
| Status + setup ✓ signals for the checklist | `lib/data/brain-status.ts` (`summariseBrainStatus`, `getSetupSignals`), action `getKairosBrainStatus`; Telegram test: `sendKairosTestMessage` |
| Connector install link | `lib/kairos/routines/setup.ts` (`claudeConnectorInstallUrl`) |
| Queue (plan, claim, submit, sweep) | `apps/web/src/lib/kairos/thinking/queue.ts` (`PLANNED_THINKING_KINDS` must equal the catalog's `BRAIN_JOBS` — a test enforces it) |
| Handlers (one per kind) | `apps/web/src/lib/kairos/thinking/handlers/*` |
| MCP tools | `claim_thinking_job`, `submit_thinking_job`, `list_thinking_jobs` |
| REST | `GET /api/v1/kairos/thinking-jobs`, `POST …/claim`, `POST …/{id}/submit` |
| Sweep cron | `/api/cron/thinking-sweep` (hourly, :50): plans due jobs for every user with an active Dominion (all kinds but concept/chat), expires overdue jobs, runs pending sweep fallbacks (≤ `KAIROS_SWEEP_MAX_FALLBACKS`, default 2, within `KAIROS_SWEEP_BUDGET_MS`) |
| Cron guard | `isJobDone(userId, externalKey)` (`lib/data/thinking-jobs.ts`): a fallback cron skips any unit whose job is `done` |

Kinds (times UTC unless stated):

| Kind | Planned (claim + hourly sweep) | Deadline | `external_key` | Backup |
|---|---|---|---|---|
| `chat_distill` | 01:00Z, one per thread with operator messages yesterday | 01:58Z | `chat_distill:<threadId>:<YYYY-MM-DD>` | `chat-distill` 02:00Z |
| `archetype` | 01:36Z, once tonight's chat distill is settled | 02:28Z | `archetype:<dominionId>:<YYYY-MM-DD>` | `archetype-synthesis` 02:30Z |
| `cortex` | once today's archetypes exist (02:30Z) | 02:58Z | `cortex:<dominionId>:<YYYY-MM-DD>` | `cortex-regen` 03:00Z |
| `concept` | Sundays — nightly engine + claim only, ≤ once per ISO week | 6 h | `concept:<dominionId>:<ISO week>:<member-set hash>` | sweep |
| `aether` | once tonight's cortex work is settled | 03:13Z | `aether:<YYYY-MM-DD>` | `aether-regen` 03:15Z |
| `belief_extract` | daily ≥02:30Z, when new operator signals exist | 4 h | `belief_extract:<YYYY-MM-DD>` | sweep |
| `drift_probe` | daily once aether ran today, or ≥03:30Z; needs a live constitution | 2 h | `drift_probe:<YYYY-MM-DD>` | sweep |
| `idea_generate` | daily once tonight's aether is settled, ≥03:30Z | 55 min | `idea_generate:<YYYY-MM-DD>` | sweep |
| `idea_judge` | when the night's `idea_generate` answer is applied | 45 min | `idea_judge:<YYYY-MM-DD>` | sweep |
| `ask_mine` | 03:15Z, once aether is settled | 04:28Z | `ask_mine:<YYYY-MM-DD>` | `ask-mine` 04:30Z |
| `mind_compare` | Mondays ≥04:00Z, both minds hold beliefs | 3 h | `mind_compare:<ISO week>` | sweep |
| `weekly_review` | Mondays ≥05:00Z, with review signal | 6 h | `weekly_review:<ISO week>` | sweep |
| `constitution_seed` | Mondays 04:00–05:56Z, only while there is no constitution and no pending draft | 05:56Z | `constitution_seed:<ISO week>` | `constitution-seed` 05:58Z (BYOK users only) |
| `daily_message` | from 04:00Z once tonight's aether, ideas and ask are settled (from 04:35Z regardless), only when the UTC date equals the London date; reads each area's latest cortex headline; the numbered open-questions block is added by code at send time | 05:55 London | `daily_message:<London date>` | `daily-message` cron 06:00 London (paid key → plain text) |
| `chat` | never planned — a web (`/kairos`) or Telegram chat message creates it; claimable only with `kinds: ["chat"]` | timeout + 30 s | `chat:<threadId>:<userMessageId>` | chat watchdog (paid key, if the Paid backup switch is on) |

Job lifecycle: `queued` → `claimed` (token, attempts+1) → `done` | `failed` (cron kinds, on a
rejected or late answer; their cron covers it) | `expired` (deadline passed, swept; or a
sweep kind whose answer was late/rejected) → `fallback` (sweep kinds, when the paid
fallback succeeded). Idempotency: `unique(user_id, external_key)` — a failed or expired job
is not re-planned; its backup covers it.

## Chat (web + Telegram), in detail

Both channels share one flag (`KAIROS_CHAT_ROUTINE`, alias `KAIROS_TELEGRAM_ROUTINE`) and one
routine. **Telegram:** the webhook saves the operator's message, shows "typing…", queues one
`chat` job, returns 200, then fires the routine. **Web** (since 0.19): the `/kairos` send action
saves the message, queues the same kind of job, fires the routine and returns `pending: true`;
the page polls the thread for the reply. Flag off or routine not configured → the reply is
written inline on the paid key, as before.

Each job is `chat:<threadId>:<userMessageId>` with deadline = timeout + 30 s; the fire is
`POST https://api.anthropic.com/v1/claude_code/routines/{ROUTINE_CHAT_ID}/fire`.
A watchdog polls every 3 s for up to `KAIROS_CHAT_ROUTINE_TIMEOUT_MS` (default 60000, cap
120000); a job the routine has *claimed* gets until its deadline + 15 s. Not done → the
watchdog takes the job and answers on the paid key — or, with the Paid backup switch off,
posts "I couldn't answer on your Max plan just now — try again in a minute." One reply per
message either way; a newer operator message supersedes an unanswered one. Each fire counts
against the routine's run limit (30/h per routine); a burst beyond it goes straight to the
backup. Optional: `KAIROS_CHAT_ROUTINE_POLL_MS` (default 3000, cap 10000).

## Limits

Routines are a research preview on Pro/Max: minimum interval one hour; 100 scheduled runs
an hour per account; 30 API fires an hour per routine. Runs draw on the plan's normal
usage; when it is exhausted, runs are rejected until the window resets and the backups
cover the night. `thinking-sweep` and REST claim declare `maxDuration = 300`; the MCP claim
runs inside the shared MCP route.
