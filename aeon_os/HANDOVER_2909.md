# Handover 2909 — Kairos reassessment → "Eyes & Heal" + five modules

**Date:** 2026-09-29 · **Repo:** shadow_app_aeon · **Branch:** main @ 6cc909f (clean; only untracked `aeon_os/HANDOVER_2209.md`, `research/`)
**Session type:** planning + investigation only. **Nothing in the code changed. Nothing deployed. No board card moved.**
**Full evidence:** `research/kairos_2909/01..04` (five prowler/crawler lanes, condensed with file:line). Memory note: `project_kairos_reassessment_2909`.

## Why this session happened
Owner pasted the last week of Kairos Telegram output (evening digests + ticks). Digest 27/09 shipped a WordPress manual; 28/09 reported aether-regen failed. Owner then asked for a rigorous reassessment of the whole Kairos build (what lasts, what was overkill), and finally to compare it against the ORIGINAL June blueprint ("Ultron": rings, five modules) and plan the way forward from SOTA.

## The four live defects (all root-caused, none fixed) — see `research/kairos_2909/01`
1. **Digest runaway text**: model never emitted end_turn, free-ran to the 1500-token cap; `digest.ts` ignores `finishReason` and forwards raw text unguarded. Fix = 2-line guard → existing deterministic fallback. Same class in Telegram chat reply path.
2. **aether-regen parse_failed**: prompt makes the model mint UUIDs; zod 4 strict; aether uses an old private repair copy. Fix = short labels in gen schema, server-mint ids, remap tensions, use shared `parseWithRepair`. (cortex failed the same way 17/09.)
3. **Asks dead since July**: any tick `notify` arms the 48h `awaitingReply` gate (`engagement.ts:59-66`); verified via prod dry-run → `awaiting_reply`. Fix = gate only on `kind==='question'`.
4. **Health scorecard sees only BRIEF**: generators trace failure only; BRIEF has 3 stage keys; history capped at 100. Fix = `writeCronSuccessTrace` per runner + one key.

## Runtime truth (read-only DB, shared prod) — see `research/kairos_2909/02`
3,881 proposals, 0 ever accepted · 43 reflections all time · 2 asks ever · 6 dialogues ever · 7 operator chat turns in Sept · galaxy loads all 7,853 memories unfiltered (crash cause) · 0 `resolves` links · session captures all land as `idea` class, taskId always null, missions captured as `.aeon-worktrees` · Hangar reads/writes nothing in Kairos.

## Verdicts (owner-corrected frame: judge by MESH WIRING + LOOP CLOSURE, not usage)
- **KEEP** the whole pyramid (archetypes→cortex→aether), micro-consolidate, intent layer, proposal engine, Live Mind pieces. Nothing from Live Mind gets disconnected.
- **The diagnosis:** the mesh generates but never metabolises — no loop closes (proposals never re-enter, asks blocked, brief ignores synthesis, missions never write in). Everything waits on the operator.
- **MERGE** the old-vs-new duplicates (2 ranking stacks, 2 ask producers, 2 repair impls, 2 EOD forms, 3 brief displays, streamClass vs type, dominion_repos vs hangar_repos, 4 tension producers).
- **DELETE** only true stubs (memory-compaction cron, initiative-metrics, eval-metrics, recipes/index, retrieveForChat, prepareContextForUser action).

## Blueprint vs built — see `research/kairos_2909/04`
Ring 0 ✅ · Ring 1 🟡 (1 of 5 recipes, 1 of 4 lieutenants unscheduled, no Concept tier, no council, no decision graph) · Ring 2 ❌ zero code (no initiative stream, no dark_lab_kairos, no deep-think). Owner's five modules = Ring 1 completion + Ring 2 start.

## The plan (proposed, AWAITING OWNER GO)
| Phase | Scope | Size |
|---|---|---|
| **P0 Eyes & Heal** | structured session record (task/session/branch/commits/PRs/tests/cost) from all clients; `defaultStreamClass(source,type)` choke point in createMemory; mission envelope → memory (one-liner at `api/v1/sessions/[id]/events/route.ts:123` + `attachSessionMemory`); worktree slug + env propagation fix; recency alignment (cortex/aether "today so far" off-by-day, digest 18→18 window, 21:15-24:00 gap, rerank ignores recency, validAt=endedAt); the 4 defects; one outcome row per cron; galaxy = filter to signal types + InstancedMesh | 2 sessions |
| **P1 Memory evolution** | candidate tier (today's proposals) promoted on lineage-aware independent evidence across days; Mem0-style write gate; generation-swap consolidation + revert; Concept tier (spec 26) | 2 |
| **P2 Philosophical + Strategic** | belief ledger + reasons-based constitution + drift probes; briefer rewired to read the brain; weekly structured review; one daily message | 2 |
| **P3 Creativity** | nightly idea tournament (stratified generate, critique vs evidence, pairwise judge, evolve) + pgvector novelty gate; replaces raw introspection | 1-2 |
| **P4 Motivational** | initiative engine (spec 17 P8): goal archive w/ verifiers, commitment ledger cron-checked, Telegram approve/veto, Hangar as hands | 2 |
| **P5 Ring 2 proper** | dark lab, deep-think jobs, self-authored recipes — gated on P4 track record | later |
Governance across all: autonomy level per action class, veto-not-approve for memory, approve-before-act for cards in others' projects, budget/turn caps, kill switch, never a self-continuity goal.

## Decisions the owner still owes (asked, not answered)
1. Go on P0 now?
2. Memory promotions: veto-only (Kairos promotes under rules, owner can revert)?
3. Initiatives: will the owner tap approve/veto on Telegram? If not, initiatives stay inbox proposals and Kairos never acts on them.
4. Spec home: `docs/kairos/32-*.md` in repo vs memory only. (This handover + `research/kairos_2909/` is the interim answer.)

## First actions for the next session (once P0 is a go)
1. Read this file, then `research/kairos_2909/01` (bugs) and `03` (capture). Do not re-prowl; the evidence is current as of 2026-09-29.
2. Branch `feat/kairos-eyes-and-heal` off main. Order inside P0: (a) the 4 defect fixes (small, testable, each with its listed tests) → (b) `defaultStreamClass` choke point + `CONFIDENCE_BY_STREAM` additions → (c) mission envelope → memory → (d) session record + dispatcher env propagation + worktree slug → (e) recency alignment → (f) success traces → (g) galaxy filter + instancing (Speed Demon lane, measure at 300/1000/3000 nodes).
3. Verify tier MEDIUM: vitest + a prod `?dryRun=1` of ask-mine after the gate fix (expect `no_signals`/`created`, not `awaiting_reply`), and watch tonight's 03:15Z aether-regen trace.
4. Board card: **"Kairos: close the loops — Eyes, Heal, five modules"** on AI Mission Control (Depot; `repo:aeon` `dom:KAIROS`), checklist groups = P0..P5. Move to Live when P0 starts.

## Addendum 3009 — owner steer after reading the plan (supersedes the phase table where they differ)
Owner read the plan and approved the direction. Explainer: `research/kairos_2909/vision/report_tabs.html` (6 tabs, markdown sources beside it). Four additions:
1. **Memory engine (P1, TypeScript, class-based composition).** `lib/kairos/engine/`: `MemoryEngine` conductor + pluggable `Step`s (Gate, Weigh, Age, BackUp, Challenge, Merge, Contest, LearnFromOperator, SelfCheck) + `Standing` composed of scorer parts (SourceTrust, Freshness w/ per-class half-lives, Support lineage-aware, Outcome, Challenged, Novelty) + `ChangeLog` (every change + reason → undo, "why do you believe this"). Retrieval = relevance × stored standing; replaces BOTH ranking stacks and the rerank-ignores-recency bug. Maths steps are pure TS (fast-check property tests); LLM steps go through a `Reasoner` interface. **No Python**: none in the repo, math is simple, pgvector does vectors.
2. **Run cognition on the owner's Claude Max plan (P1-P2).** Verified 30/09 (crawler, tier-1): routines (research preview) run on Pro/Max, schedule ≥1h or API fire (30/hr/routine), use claude.ai custom connectors incl. writes, count against plan usage; max runtime undocumented → keep runs short. **Anthropic forbids the server calling Claude with plan OAuth creds** (legal-and-compliance page; consumer terms 3a). So: a **thinking-job queue** — cron posts jobs, a Max routine claims via MCP (`claim_thinking_job`/`submit_thinking_job`, REST mirror for parity), server validates + mints ids + writes; unclaimed past deadline → `ApiReasoner` on the BYOK key → deterministic fallback. Generalises the existing prepare_aether_context/commit_aether pattern. Routines: night shift ~03:00, dawn shift ~05:30, daily message ~07:30, pulses, weekly review. Channels (Telegram plugin) rejected: needs an always-on local session. Telegram chat: webhook acks "thinking…", fires a chat routine via API trigger, fallback to API if no reply in time — measure latency in P1 before switching (P2). Owner's coding moves to an Enterprise seat; capture hooks are local so capture continues.
3. **Board as the main feed (P0, "Eyes").** Owner runs the day on **AS Sprint** (`9c62a80f-491f-44de-b433-349ce3e0c1fe`, dom Dominion `d77898b4…`) + its vault. Prod 30/09: 36 live cards, 36 no description, 17 title-only; vault 320, 315 no description, 214 title-only, 69 vaulted in 30d; 688 board memories in 30d (title-only event noise from `auto-capture.ts` "completed · name"). Build: per-board daily page (planned / did / finished with title+description+checklist+labels+daysTaken, from board_tasks + task_vault) replacing per-event memories; title-only-card nudge (≤3/day inside the daily message, answer written back to the card description + memory; needs the ask-gate fix); weight: finished card with notes = strong operator evidence, title-only = weak until explained, open cards = intent (drift detection). Good board day ⇒ no voice-note prompt.
4. **Voice**: Claude app voice + Aeon connector (reported bug: custom tools may fail in voice — owner to test once); phone keyboard dictation into the card editor works today. Telegram voice notes still unsupported (open question).
5. **6 Oct 2026 change** (support.claude.com 15520349 + 13854387, updated 29/09): new Cowork tasks on Pro/Max run in the cloud; the "Only on your computer" option is removed; tasks already running locally stay local; cloud tasks can't use local folders. Affects Cowork/Claude-app scheduled tasks only, NOT Claude Code routines. Net positive: a second cloud runner with connectors (built-in schedules only, no documented API trigger) → backup runner for the thinking queue; routines stay primary (API fire + custom cron + repo checkout).

## P0 status (30/09 ~13:30) — CODE COMPLETE, UNCOMMITTED, NOT DEPLOYED
Branch `feat/kairos-eyes-and-heal` (off main 6cc909f), all work uncommitted in the tree. 3 waves × 12 executor lanes + warden (PASS_WITH_NOTES → all 3 medium + 3 low findings fixed). Checks: `tsc` clean · vitest 4,219/4,220 (the 1 = `TaskAttachments.test.tsx` load flake, untouched, passes alone) · capture-script tests 63/63 · eslint 0 errors on 108 changed files. Changelog: `docs/kairos/CHANGELOG.md` 0.11.0.
- **Already live:** `settings.kairosFeed` set on AS Sprint (`daily`) and STP Sprint (`weekly`) via MCP (inert until deploy). The session-capture `.mjs` scripts run from this working tree, so the new session record / worktree slug / tag clamp are ALREADY capturing live.
- **After deploy, verify:** prod `GET /api/cron/ask-mine?dryRun=1` → not `awaiting_reply`; 03:15Z aether-regen ok two nights; digest has no runaway text + names missions; galaxy opens (eyeball edge brightness `EDGE_LIT` in `components/kairos/galaxy/GalaxyEdges.tsx`); first AS Sprint "board day" page after 23:00Z.
- **Kept on purpose:** `components/kairos/scene/PlanetCloud.tsx` + `Planet.tsx` no longer rendered (only `SceneNode` type imported) — delete after the owner's visual OK so rollback stays one line.
- Known low risks: existing board pages / old rows not reclassified (no backfill); vault-note write sends no realtime event; hook adds ≤~0.3s git reads at SessionEnd.

## Owner decisions 3009 (answers to the open questions)
- **P0: GO** (30/09 11:39). Executed on branch `feat/kairos-eyes-and-heal`.
- **Boards:** AS Sprint (`9c62a80f…`) = the active daily feed. STP Sprint (`a914e100-bf4f-4b5e-9241-f281da019ecd`) is passively managed but still represents team milestones → read **weekly** as a milestone/priority check (does the board still reflect core priorities; drift vs actual work). Owner will refresh STP Sprint to as-is this week.
- **Beliefs = two minds in parallel.** Kairos keeps (a) an operator-aligned mind anchored on the owner's reflections/board, and (b) **his own mind that grows and evolves independently** (own beliefs, promoted under the evidence rules, not steered by the owner). Both are kept side by side so the owner can compare his reflections against Kairos's own, and judge whether both are worth keeping. Design impact: P1/P2 belief store gets a `mind: 'aligned' | 'own'` axis + a comparison view/report. Veto still applies to promotions into the aligned mind; the own mind is observe-and-compare.
- **Telegram voice notes:** not needed yet.
- Still unanswered: ship mode (PR vs self-merge) and whether to commit research/handovers.

## Traps (do not relearn)
- Drizzle journal frozen @0010: NEVER `db:generate`/`db:push`; hand-write migrations + `verify-schema-drift.mjs`. Dev and prod share ONE Neon DB — every local migration is a live write.
- MCP/REST parity CI (Gantt locked; memories parity tests assert tool-name sets via source regex).
- Quality-over-cost directive stands: all cognition stays heavy tier. Do not downgrade models to save money.
- Never use the AskUserQuestion widget; ask inline as numbered emoji questions.
- Corp network drops curls (000 → retry). Neon driver: call `sql(text)`, not `sql.query`. Node scripts need `PYTHONIOENCODING`-style care for unicode in Python printing.
- `.claude/` and CLAUDE.md are gitignored here; skills live in `~/.claude/skills` (shared with Copilot/Codex via junctions).
- The brain-tick is a claude.ai cloud routine, not a Vercel cron — its schedule is outside the repo.
