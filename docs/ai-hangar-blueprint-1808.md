# AI Hangar — V1 Blueprint (1808)

**Vision:** a new kind of Aeon board — the **AI Hangar** — where cards are agent missions. Card describes *intent*; skills describe *behaviour*; the repo provides *knowledge*; the agent provides *reasoning*; the runner merely starts the process. Aeon = remote task inbox + structured context + result store.

**Grounding:** Archon recon (5 prowlers, `docs/archon-recon-1808.md`) + 3-prowler Aeon/fleet recon (2026-08-18). Headless mechanics verified current: `claude -p --output-format stream-json --permission-mode` is the standard unattended pattern; Agent SDK optional later.

---

## 1. The decisive discovery: ~80% already exists in Aeon

| Piece | Status | Where |
|---|---|---|
| `agentSessions` table (queued→running→succeeded/failed/killed/timeout, engine, repo, branch, prompt, cost, workerHost/Pid, metadata) | ✅ EXISTS | `schema.ts:606-635`, migration `0019` |
| `sessionEvents` append-only log (monotonic seq, idempotent replay, tool_use/message/stop/error kinds) | ✅ EXISTS | `schema.ts:653-665` |
| REST `/api/v1/sessions` (+`[id]`, `/events`, `/kill`) + 5 MCP session tools + shared Zod validators | ✅ EXISTS | `app/api/v1/sessions/*`, `tools/sessions.ts` |
| Local worker that shells `claude -p` in a repo dir, streams stdout→events, PATCHes final status | ✅ EXISTS | `apps/kairos-worker/` (push model) |
| Live session UI (4s status poll, 2s transcript tail) | ✅ EXISTS | `LiveSessionsButton.tsx` |
| Card↔session link | ❌ missing | add `agentSessions.taskId` |
| Pull/claim (poller) dispatch | ❌ missing | today Aeon pushes to `KAIROS_WORKER_URL`; unset = rows sit `queued` — **that degraded mode IS the poller queue, already exercised** |
| Hangar card payload + board mode + result envelope | ❌ missing | pure new code, zero risky schema |

**The only real architectural pivot: push → pull.** `dispatchSpawn()` requires Aeon to reach the worker's URL. The Hangar model inverts it — the runner polls out to Aeon and claims queued sessions. NAT-friendly, no tunnel, matches Archon's "session = DB row, runner initiates" lesson. The push path stays untouched for Kairos; Hangar rows simply never set `KAIRO_WORKER_URL` dispatch.

## 2. Design decisions (locked by recon)

1. **Hangar = board mode, not new tables.** `projects.settings.boardMode='hangar'` switches the existing kanban's card editor/renderer. Columns map to session lifecycle: **Hangar (queued) → Flight (running) → Tower (needs_input) → Landing (review) → Done**. Later: "Run as AI task" on any normal card (card-capability variant) — same metadata, no board flag.
2. **AI-card payload lives in `boardTasks.metadata.hangar`**, Zod-validated at the data layer (house idiom). No new task columns.
3. **Result envelope = terminal `sessionEvents` row with `kind:'result'`** — timeline stays the single source of truth, naturally idempotent; don't widen the session row.
4. **Objective types are contracts, not engine machinery.** 5 for V1: `bug_fix`, `implement`, `recon`, `analysis`, `plan`. Each is a short prompt-contract template (stored as a runner-side template or global skill) defining "what finished means" + the result envelope. NOT related to Aeon's existing `dominionObjectives`/`run_recipe` (false friends — Kairos machinery, don't touch).
5. **Two engines, two shapes** (Archon proved don't unify): `claude` = runner spawns headless CLI; `copilot` = GraphQL assign (kairos-delegate recipe), no runner involvement, poll PR status.
6. **Tiny dispatch prompt** — the card doesn't flatten context. Runner sends: task id + objective + user text + skills list + "you have repo CLAUDE.md/architecture + Aeon MCP; fetch more via `get_task_detail`". The repo does the rest (fleet survey: **`cd + claude -p` works in every repo for code tasks**; only live-app verification needs registry `run_cmd`).

### The AI-card schema (~18 fields, all in `metadata.hangar`)

```yaml
# objective
objective: bug_fix | implement | recon | analysis | plan
# execution context
repo: arq                      # registry id = repo:* label taxonomy
base_branch: null              # default from registry
agent: claude | copilot
model: null                    # optional override
skills: [investigate-bug, run-tests]
subagents: [codebase-recon]    # optional
# human context
instruction: |                 # typed request / pasted traceback / voice vomit
attachments: []                # blob refs (existing attachments infra later)
# linked context
linked_cards: []               # task ids
linked_docs: []                # urls / vault paths
# expected output
output_mode: branch_and_summary | report | artifacts | plan_and_cards | answer
artifact_dir: null             # e.g. docs/investigations/
# runtime (written by system, not user)
session_ids: []                # spawn history, latest = active
last_result: {...}             # cached terminal envelope for card face
```

### Result envelope (posted as `kind:'result'` event)

```json
{ "status": "completed|needs_input|failed",
  "outcome": "fixed|implemented|investigation_complete|planned|blocked",
  "summary": "...", "branch": "eon/AEON-184", "commit": "7c12ad9",
  "artifacts": [], "tests": {"status":"passed","summary":"142 passed"},
  "questions": [], "recommended_tasks": [] }
```
`needs_input` → card auto-moves to **Tower** and renders `questions`; answering re-dispatches with the answers appended (session resume later, fresh session V1).

### Runner registry (per fleet survey)

```yaml
- id: arq
  path: C:/Users/anselikhov/data_science/dev_26/shadow_app_arq
  default_base_branch: main
  branch_prefix: fix/          # runner names branches eon/<taskId>
  env_setup_cmd: null          # claude works from repo root everywhere
  run_cmd: "start_arq.bat"     # only for tasks needing the live app
  runtime: [hatch]
```
Traps from survey: hydra is docker-only (`run_cmd: podman-compose up`, podman-machine hibernation gotcha); swarm is dual-runtime (npm + hatch env before its .bat); the runner host needs the hosted Aeon MCP pre-approved once in global `~/.claude/settings.json` (not per-repo); prune worktree/agent branches on completion (ermac has strays).

## 3. Build plan — fastest path (3 sprints, vertical slice first)

### 🛫 Sprint 1 — the loop closes (backend + runner, no UI)
1. **Migration `0031_hangar_claim.sql`** (hand-written; head is `0030`, docs say `0026` — stale): `agentSessions.taskId` (FK boardTasks, SET NULL, indexed), `claimedBy`, `claimedAt`, `lastHeartbeatAt`.
2. **`claimNextSession()`** in `lib/data/sessions.ts`: single transaction, `FOR UPDATE SKIP LOCKED`, filter `engine IN ('claude','codex')` (kairos-chat rows share the table!). ⚠️ New pattern for this codebase + Neon 8s pool timeout — warden review mandatory.
3. **`POST /api/v1/sessions/claim`** + MCP `claim_session` + **`sessions-parity.test.ts`** (closing the flagged drift gap in the same pass).
4. **Result handling:** accept `kind:'result'` events; on terminal status with `taskId` set → write `metadata.hangar.last_result`, move card column, `publishBoardEvent(projectId, {type:'task:updated'})` → existing Pusher/30s-poll carries it to the UI free.
5. **`aeon-runner`**: evolve `apps/kairos-worker` with a poll mode (keep push path intact): claim → registry lookup → `git worktree`/branch `eon/<taskId>` → `claude -p "<dispatch prompt>" --output-format stream-json --permission-mode acceptEdits` → stream events (reuse `callback.ts` verbatim) → parse/post result envelope → heartbeat + cooperative kill check.
6. **Dispatch action** `spawnSessionFromCard(taskId)`: validates `metadata.hangar`, creates queued session — callable from MCP immediately (spawn from chat before UI exists).

**Exit test:** create a hangar card via MCP with a real arq bug → runner claims → branch + result envelope lands → card moves columns on the live board. *The whole V1 loop, provable without touching the frontend.*

### 🛬 Sprint 2 — the Hangar board
`boardMode='hangar'` flag + board-create option · hangar card editor (objective picker, repo dropdown from labels, agent/skills selectors, big instruction textarea) · live status chip + transcript drawer (adapt `LiveSessionsButton`) · result viewer on card back · Tower (needs_input) rendering with answer box · "Launch" button = the dispatch action.

### 🗼 Sprint 3 — second engine + polish
Copilot engine (productize kairos-delegate: assign via GraphQL, poll PR/CI into events) · `plan` objective auto-creating follow-up cards from `recommended_tasks` · retry/re-dispatch UX · Telegram `approve/answer` verbs through the same actions · session resume.

### ⚠️ Standing traps
Migration journal frozen — **never `db:generate`** · `aeon_k1_` keys are unscoped (runner key = full user access; acceptable solo, revisit for realm members) · never auto-fail a session on staleness — surface "unresponsive" + one-click resolve (Archon rule) · approval/needs-input answers are typed actions, never inferred from prose.

---

# Addendum 1908 — multi-engine portability + repo registry

## 4. Three engines, one repo brain (verified 2026-08-19)

**The standards war already resolved in our favor:**
- **AGENTS.md** is the open instruction standard (Linux Foundation / Agentic AI Foundation) — read natively by **Codex CLI, GitHub Copilot coding agent, Cursor, Gemini CLI** and ~10 others. **Claude Code still reads CLAUDE.md only**; the official bridge is a CLAUDE.md containing `@AGENTS.md`.
- **Agent Skills (SKILL.md)** became a cross-tool open standard (Anthropic-originated, adopted by Codex weeks later, ~40 tools incl. Copilot as of mid-2026). **Our existing skills are already format-portable** — only *discovery paths* differ: Claude `.claude/skills/` + `~/.claude/skills/`; Codex `.codex/skills/` + `~/.codex/skills/` (newer shared convention: `.agents/skills/`).

### Portability plan — pure piggyback, no rewrites

1. **Per-repo instruction split** (done incrementally, only as a repo onboards to Hangar): move repo knowledge (commands, architecture pointers, standards, verification tiers) from CLAUDE.md into **AGENTS.md (canonical)**; CLAUDE.md shrinks to `@AGENTS.md` + Claude-specific workflow (aeon-dev-live auto-invoke, board block). One brain, three readers. (Archon itself ships exactly this shape: 1-line CLAUDE.md → 85KB AGENTS.md.)
2. **Skills via directory junctions** (Windows `mklink /J`): keep `.claude/skills/` canonical; junction `.codex/skills` and `.agents/skills` → it. Same at host level: `~/.codex/skills` → `~/.claude/skills`. Every engine discovers identical skills, zero duplication.
3. **Objective contracts as GLOBAL skills** (`eon-objective-bug-fix`, `-implement`, `-recon`, `-analysis`, `-plan`) in `~/.claude/skills/` on the runner host → junctioned into Codex — written once, work in every repo, every engine.
4. **MCP for all engines**: aeon MCP already hosted/HTTP; runner onboarding adds it to `~/.codex/config.toml` and Copilot CLI's MCP config so Codex/Copilot sessions can also call `get_task_detail` / post context.
5. **`hangar-onboard <repo>` script** does all of the above per repo: AGENTS.md split + junctions + registry entry. ~15 min per repo, one-time.

### Engine invocation matrix (runner)

| engine (card field) | Invocation | Notes |
|---|---|---|
| `claude` | `claude -p "<dispatch>" --output-format stream-json --permission-mode acceptEdits` | fully verified pattern |
| `codex` | `codex exec "<dispatch>"` (+ JSON output flag) | **kairos-worker spawner already stubs this** — nearly free |
| `copilot-cli` | Copilot CLI non-interactive prompt mode | reads AGENTS.md + skills + MCP; verify exact flags during Sprint 1 build |
| `copilot-cloud` | GitHub GraphQL assign (kairos-delegate recipe) | no runner involvement; poll PR/CI into sessionEvents |

## 5. Repo registry — in-app, bespoke cards confirmed

Registration moves **into Aeon** (owner call): a **`hangarRepos` table** (realm-scoped), managed from a Hangar board settings panel ("Hangar Bay"), with MCP/REST parity tools (`register_repo`/`list_repos`/`update_repo`).

```
hangarRepos: id, realmId, slug (matches repo:* label taxonomy), name,
  gitUrl, ghSlug (owner/repo — needed for copilot-cloud assign),
  defaultBranch, branchPrefix, allowedEngines[], runCmd, envSetupCmd,
  appUrl, notes, active, metadata jsonb
```

**Split of truth:** Aeon holds the *logical* repo config (above); **host-local paths stay runner-side** (`repos.local.yaml`: slug → path) — Aeon can't know every machine's disk layout, and this keeps multi-host runners possible later. Runner heartbeat can report per-repo *capabilities* back into `hangarRepos.metadata` (engines detected, skills discovered) — the card editor's skill/agent pickers then show real options, not guesses.

**Bespoke cards:** confirmed — the Hangar card gets its own dedicated editor UI (objective picker, registry-fed repo dropdown, engine selector filtered by `allowedEngines`, skills multi-select from reported capabilities, instruction area with paste/voice dump, output-mode). Storage is unchanged (`boardTasks.metadata.hangar`); the registry is the only new table beyond migration `0031`.

### Sprint impact
- **Sprint 1** += `hangarRepos` table + parity tools + `hangar-onboard` script + `codex` engine (stub exists) — small additions.
- **Sprint 2** += Hangar Bay registry panel + registry-fed bespoke card editor.
- **Sprint 3**: `copilot-cloud` + `copilot-cli` engines, capabilities heartbeat.

## 6. POC directive (1908) — **Copilot-first** (owner constraint)

**The POC MUST run on Copilot** — enterprise Copilot is the sanctioned tool at work; Claude usage is under scrutiny. This reorders the engine plan without changing the architecture:

1. **Primary POC engine = `copilot-cli`.** Verified: official programmatic mode — `copilot -p "<dispatch>" --allow-tool <...> --no-ask-user [--model <m>]` — documented incl. on GitHub *Enterprise Cloud* docs. Runner spawns it exactly where it would have spawned `claude -p`. Copilot CLI reads **AGENTS.md natively** (not CLAUDE.md) → the `hangar-onboard` AGENTS.md split is now a **POC prerequisite** for target repos, not a nicety. Copilot CLI also supports skills + MCP → junctioned skills and the aeon MCP hook carry over.
2. **Secondary POC engine = `copilot-cloud`** for GitHub-hosted repos: GraphQL assign → draft PR (already proven end-to-end by the kairos-delegate recipe, 2026-07-11). Zero runner, GitHub's compute — the most enterprise-friendly path of all.
3. **Engine-agnostic result envelope:** don't depend on any engine's structured-output mode. The objective contract instructs the agent to end with the envelope in a fenced ```json block; the runner extracts it from stdout (raw stdout chunks stream as `message` events either way — kairos-worker already does this). Works identically for copilot/codex/claude.
4. **Claude stays in the matrix** but off the POC critical path — personal repos (aeon itself) only, until the work posture changes.
5. **Revised Sprint 1 exit test:** hangar card (e.g. real arq bug) → runner claims → `copilot -p` in the onboarded repo → branch + fenced-json envelope → card moves on the live board. **First repos to onboard: the POC target work repo(s) — AGENTS.md split + skills junctions + registry entry.**

---

## 7. Build-and-run runbook (1908) — native-Claude POC

**Migration posture:** CLAUDE.md stays canonical. Each onboarded repo gets a 3-line **AGENTS.md stub** ("Canonical instructions live in CLAUDE.md — read it fully before acting; skills in `.claude/skills/`"). Full AGENTS.md split + skills junctions deferred until Copilot becomes the primary engine. Claude-native flow is untouched.

**BUILD (in order):**
1. Fresh branch `feat/ai-hangar` off main (single-branch discipline — land/park the pro-wave branch first).
2. Migration `0031_hangar.sql` (hand-written; db:push for dev): `agentSessions` += `taskId` FK / `claimedBy` / `claimedAt` / `lastHeartbeatAt`; new `hangarRepos` table.
3. Validators: `hangarCardMetadataSchema` (~18 fields), claim/result/registry schemas.
4. Data layer: `claimNextSession()` (FOR UPDATE SKIP LOCKED, `engine IN ('claude','codex')` filter), registry CRUD, result handler (`kind:'result'` event → `metadata.hangar.last_result` + column move + `publishBoardEvent`).
5. REST `POST /api/v1/sessions/claim` + hangar-repos routes; MCP mirrors (`claim_session`, `register_repo`, `list_repos`); `sessions-parity.test.ts`.
6. Action `spawnSessionFromCard(taskId)` — validates `metadata.hangar`, creates `queued` session (no `dispatchSpawn`).
7. Runner: poll mode on `apps/kairos-worker` — claim → `repos.local.yaml` path lookup → branch `eon/<taskId>` → `claude -p "<dispatch>" --output-format stream-json --permission-mode acceptEdits` → stream events → extract fenced-json envelope → post result → heartbeat + cooperative kill.
8. Global objective skills `~/.claude/skills/eon-objective-{bug_fix,implement,recon,analysis,plan}/SKILL.md`.
9. Warden review (claim CAS + runner), typecheck + tests.

**RUN (POC exercise):**
1. AGENTS.md stub + `register_repo` + `repos.local.yaml` entry for first target repo (aeon or arq).
2. Start runner with `AEON_API_KEY` (poll ~15s).
3. First card via MCP: **recon objective** (read-only — safest loop proof). Watch Hangar→Flight→Landing + envelope.
4. Second card: real **bug_fix** → verify branch, tests, envelope, column moves on live board.
5. Then Sprint 2 (Hangar board UI).

---
*Companion: `docs/archon-recon-1808.md` (mechanism deep-dive). Sources verified 2026-08-18/19: [Archon repo](https://github.com/coleam00/archon) · [headless mode guide](https://amux.io/guides/claude-code-headless/) · [AGENTS.md field guide](https://www.iuriio.com/blog/posts/2026/05/agents-md-field-guide-2026) · [CLAUDE.md vs AGENTS.md](https://bestagent.dev/claude-md-vs-agents-md-2026/) · [Agent Skills standard](https://www.agensi.io/learn/agent-skills-open-standard) · [Codex skills paths](https://www.agensi.io/learn/where-are-codex-cli-skills-stored) · [OpenAI skills blog](https://developers.openai.com/blog/skills-agents-sdk).*
