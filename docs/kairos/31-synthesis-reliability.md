# 31 — Synthesis Reliability (Vision Phase 1: Heal the Instrument)

**Status:** implemented & inquisitor-validated PASS (0 high/med, 4 low advisories) · 2026-07-22 · branch `feat/kairos-synthesis-reliability`
**Deferred (low advisories):** strict calendar-adjacency check for the 2-strike rule (harmless for fixed-time daily crons); dedicated opsAlert audit log line; folding aether.ts onto the shared repair helpers; repair retry cannot rescue `finishReason:'length'` truncation (by design — matches root cause).
**Problem:** cortex/introspection (and archetypes/contradiction) nightly synthesis has parse-failed since ~2026-07-10 with no retry and near-zero observability; aether-regen failures were silent for 2 nights. The self-model every autonomy surface reads from has been degrading for ~12 nights unnoticed.

**Root cause (prowler recon, 2026-07-22):** the four standard-tier generators share a fragile parse path — `extractJsonBlock()` (naive fence/brace extraction, `_prompt-utils.ts:23-36`) → raw `JSON.parse` → hard zod `.parse()` — with **no repair round-trip**. Only `aether.ts` received the one-shot JSON-repair retry in the 07-09 reliability batch (`6a577d5`, `aether.ts:305-325`). Prod error signature is malformed content (unescaped quote mid-array: `Expected ',' or ']' after array element`) plus zod `too_big`/`invalid_type` violations — **not** truncation. Onset coincides with substrate richness growth (07-09..11), worsened by the temperature default flip (0.3→provider default, `02837f8`) and by output caps genuinely binding since `1512228` (07-17). Failures predate both (prod evidence: trace mentions in briefings `919b49fc` 07-10, `acfd90b7` 07-12).

---

## Part A — Parse repair in the four standard-tier generators

### Requirements

- **A1** `_prompt-utils.ts`: add exported `buildRepairPrompt(rawText, err, generatorLabel)` (generalize `aether.ts:345-357`) and async `parseWithRepair<T>(...)` that mirrors `aether.ts:305-325`: on first parse/schema failure, re-prompt the SAME provider with raw text + validation error, retry ONCE, then fail. Parameterized, no copy-paste per generator.
- **A2** `cortex.ts:336-347` — replace bare `cortexOutSchema.parse(extractJsonBlock(rawText))` try/catch with `parseWithRepair`, reusing the open provider + existing system prompt with `cacheSystem: true`.
- **A3** `archetypes.ts:278-290` — same substitution.
- **A4** `introspection.ts:153-166` — same substitution; `filterGroundedProposals` still runs after a successful (repaired) parse.
- **A5** `contradiction.ts:~142-146` — same substitution.
- **A6 observability (same PR):**
  - Add `finishReason?: string` to `CronFailureTraceInput` (`cron-trace.ts:21-27`); every generator passes `response.finishReason` on failure (today captured on `AIResponse` at `provider.ts:73,171` but read nowhere) — makes truncation (`'length'`) distinguishable from malformed content.
  - Failure traces include a **bounded** raw-output excerpt (first 500 chars, `sourceMetadata.rawExcerpt`) so failure sub-modes are diagnosable retroactively.
  - Failure reason distinguishes zod vs syntax (e.g. `parse_failed:syntax` / `parse_failed:schema`); repair-also-failed reasons follow aether's `parse_failed: ... (repair also failed: ...)` convention.

### Constraints

- **Do NOT reintroduce `temperature`** anywhere — current-gen models HTTP-400 on non-default temperature (PR #91 class). Reliability comes from the repair path, not sampling tweaks.
- The static system prompt string must stay **byte-exact** (prompt-cache guardrail) — the repair prompt is a user-turn message, never an interpolated system change.
- Exactly ONE repair round-trip per run (cost guardrail).
- `alreadyRanToday` idempotency semantics unchanged; trace writes stay best-effort/non-throwing.

### Tests (Vitest — extend `__tests__/cortex.test.ts`, `archetypes.test.ts`; create `introspection.test.ts`/`contradiction.test.ts` if missing)

- **T-A1** first `.ask()` returns JSON with an embedded unescaped quote in an array element (reproduce the real `Expected ',' or ']' after array element` error); second `.ask()` returns valid JSON → `status:'created'`, provider called exactly twice.
- **T-A2** both calls malformed → `status:'error'`, exactly one `writeCronFailureTrace`, reason documents both failures.
- **T-A3** zod-boundary: a 281-char `currentState[i]` triggers the SAME repair path (schema failures repair too, not just syntax).
- **T-A4** `.ask()` returns `{text:'<partial>', finishReason:'length'}` → failure trace records `finishReason:'length'` distinctly.

---

## Part B — Synthesis health scorecard + 2-strike alert

### Requirements

- **B1 Close the 3 silent-failure gaps (prerequisite):**
  - `chat-distill.ts:145-157` — per-thread catch also calls `writeCronFailureTrace(userId, {cronName:'chat-distill', dominionId, reason:'thread_distill_failed', error})` before continuing.
  - `memory-dedup/route.ts` + `embed-backfill/route.ts` — add cron-trace import; on uncaught exception trace to `KAIROS_OPERATOR_USER_ID` (skip gracefully if env unset), `reason:'uncaught_exception'`.
- **B2 Rollup module** `lib/kairos/synthesis-health.ts` → `computeSynthesisHealth(userId)`: pull `listTraceHistory(userId,{limit:200})`, filter to last 48h, bucket by `sourceMetadata.cronName ?? sourceMetadata.recipe` per UTC night (the two key conventions coexist — `listTraceHistory` has no cronName filter; bucket in-memory). Absence of a trace row = "no signal", NOT success (liveness detection is explicitly phase-2). Write ONE rollup memory/day: `streamClass:'trace'`, `type:'session_event'`, `sourceMetadata:{recipe:'SYNTHESIS_HEALTH', byStage, alertedStages}` — the `recipe:'SYNTHESIS_HEALTH'` tag makes `get_trace_history({recipe:'SYNTHESIS_HEALTH',limit:1})` fetch it with ZERO change to existing MCP/REST surface (pure naming convention).
- **B3 Cron route** `app/api/cron/synthesis-health/route.ts`, vercel.json `"0 8 * * *"` (free slot after briefer 07:00). Pure SQL read, no LLM/BYOK. Per-user loop (forward-compat, matches existing cron patterns). CRON_SECRET-gated; `jsonResponse` from `lib/api/response` (route-handler rule). Auxiliary cron route — exempt from MCP/REST parity (verified vs gantt-parity regex).
- **B4 2-strike alert:** a stage failing 2 consecutive UTC nights AND not already in yesterday's rollup `alertedStages` fires ONE `POST /api/v1/kairos/speak` `{kind:'notify', urgency:'high', force:true, opsAlert:true}`. Carry `alertedStages` forward — no daily re-alert; re-alert only on flap (recover → fail 2 again).
- **B5 Voice-budget exemption:** add `opsAlert: z.boolean().default(false)` to `speakSchema`, persist in `sourceMetadata.opsAlert`, and exclude `opsAlert:true` rows in `listRecentKairosSpeaks` (`memories.ts:1185-1205`) so ops alerts never consume Kairos's conversational cadence (gap/cap) bookkeeping. As-built (inquisitor-adjudicated 2026-07-22): opsAlert rows are excluded from the FORCE_CEILING count as well — the effective ops-alert rate limit is the 2-strike + alertedStages carry-forward logic in `synthesis-health.ts` (≤1 batched alert per daily rollup run, idempotent on same-day re-runs), which the inquisitor confirmed makes spam structurally impossible.
- **B6 Housekeeping surfacing** (main-agent task, NOT codex — file lives outside the repo): add "Check E — Synthesis health" to `~/.claude/skills/kairos-housekeeping/SKILL.md` reading `get_trace_history({recipe:'SYNTHESIS_HEALTH',limit:1})`.

### Tests

- **T-B1** memory-dedup / embed-backfill / chat-distill route tests: forced failure ⇒ trace row written.
- **T-B2** `computeSynthesisHealth` bucketing over fabricated 2-night trace fixtures ⇒ correct per-stage pass/fail; mixed cronName/recipe keys bucket correctly.
- **T-B3** 2-strike + `alertedStages` dedupe: alerts on night 2, silent night 3+, re-alerts on flap.
- **T-B4** speak route `opsAlert:true` excluded from `listRecentKairosSpeaks` throttle count (extend existing speak route tests).
- **T-B5** synthesis-health cron route shape test (auth, per-user loop, idempotent daily rollup).

### Open decisions (resolved)

1. Liveness/heartbeat ("ran clean" vs "never fired") → deferred to phase-2, documented in B2.
2. Rollup scope → all users (single-tenant today, forward-compat).
3. `memory-compaction/route.ts` stale "callable manually" comment → fix the comment while in the file (one line).

---

## Validation protocol (inquisitor)

Warden-tier review validates the diff **against this spec** requirement-by-requirement (A1–A6, B1–B6, all tests present and passing), plus the standing invariants: no temperature params, byte-exact cached system prompts, `jsonResponse` in route handlers, MCP/REST parity untouched, `db.transaction` atomicity where applicable, trace writes non-throwing. Exit: typecheck + full Vitest green; then 7 consecutive green prod nights (tracked on the board card).
