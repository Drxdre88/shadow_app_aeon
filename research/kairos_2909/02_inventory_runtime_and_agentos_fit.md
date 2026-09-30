# Kairos 2909 — Inventory, runtime usage, Agent OS fit

## A. Runtime numbers (read-only SELECTs against the shared Neon DB, 2026-09-29)

| Signal | Value |
|---|---|
| Live memories (galaxy loads ALL, no type filter, no cap: `lib/data/memories.ts:251-283`) | 7,853 (+ ~10k edges) |
| Introspection proposals, all time / last 60d | 3,563 all `pending` / 2,316 — **0 accepted, 0 dismissed ever** |
| Contradiction proposals | 318, all pending |
| Reflections all time (Jun 18 · Jul 8 · Aug 12 · Sep 5) | 43 (claude 22 via kairos_reflect, cron 19 via chat-distill, manual 2); **0 with wrong streamClass → EOD UI forms never used** |
| Kairos asks ever | 2 (Jun, Sep) |
| Dialogue sessions ever | 6 (Jun 3, Aug 1, Sep 2) |
| Aether by source | cron 70 / claude 4 |
| Synthesis writes per 30d | archetypes 1,367 (47 live) · cortex 268 (9 live) · aether 28 (1 live) · advisories 271 (status never set) · deltas 386 |
| Kairos speaks | ticks ~13/mo, digests ~30/mo, all status `pending` (never marked read) |
| Operator chat turns Sept (web + dialogue) | 7 |
| session_summary Sept | 470 (copilot 276, codex 86, claude 80, hook 28); **ALL streamClass `idea` since June** (backfill mapped May rows to `agentic`) |
| `resolves` links ever | 0 (supersedes 1, refers_to 9,796, contradicts 318) |
| dominion tags differing from FK | 0 (write-only feature) |
| Mission captures under slug `.aeon-worktrees` | 20 |
| Card-linked agent_sessions with dominion/memory set | 2 of 33 |
| dominion_repos vs hangar_repos | 12 vs 4 |
| dominion_objectives | 7 active, last touched 2026-09-08 |
| Cron traces last 30d | BRIEF 270 ok · SYNTHESIS_HEALTH 30 · aether 1 fail · archetypes 3 fail · cortex 2 fail (schema) |
| MCP Kairos tools (43) called in 30d local transcripts | 17 (update_memory 787 + list_memories_needing_summary 245 = summariser hook); 26 never called (all 5 dialogue, both aether, answer_kairos_ask, 12/15 dominion, create_memory, link_memory, get_belief_trail, accept_proposal, claim_session) |

## B. Inventory verdicts (owner directive: judge by MESH WIRING and LOOP CLOSURE, not operator usage)

| Element | Wired? | Loop closes? | Verdict |
|---|---|---|---|
| Substrate + captureMemory + hybrid retrieval + traces | yes | yes | KEEP (core) |
| archetypes → cortex → aether pyramid | yes (each reads the one below; aether feeds asks + chat) | yes internally | KEEP; fix quality (model-minted ids; 80-row/14d pool fills in 1-3 days at 70 sessions/day) |
| micro-consolidate deltas | yes (cortex.ts:86, aether.ts:55) | yes | KEEP (intraday pulse); fix windows (see 03) |
| introspection + contradiction proposals | produce 40/day | **NO** — never re-enter | REWIRE → candidate tier / tournament (see 04) |
| Asks (ask-mine + runKairosAsk/ask-select = 2 producers) | yes | NO (gate) | fix gate, merge producers |
| Briefer + recipes/dispatch | reads ONLY raw bundle (`recipes/brief.ts:21`), discards cortex/archetypes/substrate/traces legs it declares (`brief.ts:91`); 1 recipe, dead `expanded` branch | misconnected | REWIRE to read the pyramid; inline BRIEF, drop registry |
| Digest | terminal | n/a | KEEP + guard; merge with brief into one daily message |
| Dominion vision/mission/objectives | seed cortex/briefer/introspection prompts | yes | KEEP (intent layer) |
| `resolves` lifecycle | no writer | never | WIRE (contradiction-scan + health recovery stamp it) |
| Dominion soft tags | written = FK always | inert | give a cross-front writer (aether tensions spanning 2 dominions) or drop |
| Sentinel (`.claude/agents/sentinel.md`, gitignored) | no schedule/caller | never | WIRE as the cross-Dominion tension organ (weekly) |
| Dialogue (5 MCP tools + skill) | skill-only, 0/30d | when used | fold ritual into chat, keep distillation |
| Agent OS ↔ Kairos | missions read nothing (`lib/actions/hangar.ts:28-61`), write nothing (`lib/data/sessions.ts:262-333`; `attachSessionMemory` :335 no caller) | none | BUILD bridge (see 03 §C) |
| streamClass axis | 6 of 11 values copy `type`; forward writes never set it (`memories.ts:886-887,968`) | confuses readers | derive from type+source at ONE choke point |
| Two ranking stacks / two repair impls / 4 tension producers / 3 brief displays / 2 EOD forms / dominion_repos vs hangar_repos | duplicates | — | MERGE each pair (pick the newer) |
| memory-compaction, initiative-metrics, eval-metrics, recipes/index, retrieveForChat, prepareContextForUser | not wired | — | DELETE |

Chat grounding: 12 channels (7 baked + 5 tools, 3 duplicate). Retrieval: 8 paths. Operator input paths: 12. Crons: 15 in `vercel.json` (architecture doc says 14, omits ask-mine).

## C. Agent OS fit (confirmed by code + DB)
- Dispatch prompt = card fields + 2 skills; only Kairos touchpoint is an optional `search_memories` hint in `~/.claude/skills/aeon-dispatch-contract/SKILL.md:20`. `apps/kairos-worker` has zero memory/dominion reads or writes.
- `recordSessionResult` folds the envelope into `boardTasks.metadata.hangar.lastResult` only. `agent_sessions.memoryId` always null. `spawnSessionFromCard` never sets dominionId (`hangar.ts:142-158`).
- Accidental bridge: mission CLIs inherit the env → global SessionEnd capture fires in the worktree → 20 rows under repo `.aeon-worktrees`, taskId null (confirmed in DB).
- Realm + project are load-bearing for missions (`hangarRepos` realm-scoped `schema.ts:799-820`); Dominion only partitions synthesis and cannot see realm-shared projects owned by others (`dominions.ts:250,296-297`). `dom:*`/`repo:*` board labels are read by no code.
- Skills: `kairos-brief` + `kairos-aether` superseded by crons; `kairos-housekeeping` exists in 2 diverging copies (repo `.claude/skills` 06-02 vs `~/.claude` 07-22); `kairos-tick` thin wrapper; synced `aeon-kairos` skill tells agents to anchor spawns to a Dominion, which Hangar never does.
- Push-spawn path (`lib/kairos/spawn.ts`, `spawnSessionAction`, D17 hook `kairos-session-hook.mjs` not installed) superseded by pull Hangar → retire.
