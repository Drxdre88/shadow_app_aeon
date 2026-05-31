# Codex Integration Strategy — Supplement to Master Plan

**Created:** 24/05/2026
**Bolsters:** `00-master-plan.md`
**Premise:** Claude Code is your daily driver and stays so. Codex is the *complement*, not the replacement. This doc specifies where, why, and how.

---

## 1. The benchmark reality (May 2026)

| Benchmark | Claude (Opus 4.7) | Codex (GPT-5.5) | Verdict |
|---|---|---|---|
| **SWE-bench Verified** | 87.6% | **88.7%** | Codex narrow lead |
| **Terminal-Bench 2.0** | lower | **82.7%** | Codex dominates shell-heavy work |
| **Token efficiency** | baseline | **72% fewer output tokens** equiv task | Codex 4x more tokens/$ |
| **Sustained autonomous runs** | strong | **7+ hours** independent test-fix iteration | Codex slight edge |
| **Long context / 1M monorepo reasoning** | **1M window** | smaller | Claude wins |
| **Frontend / UX tasks** | **strong** | weak | Claude wins |
| **Nuanced code review / repo-level reasoning** | **strong** | adequate | Claude wins |
| **Extended sessions** | stable | **"erratic behavior in extended sessions"** | Claude wins |
| **Native parallel subagent fan-out** | manual via Agent View | **`spawn_agents_on_csv` built-in** | Codex wins |
| **Safety defaults** | **strong** (no silent rm, no push-to-main) | weaker by default | Claude wins for prod ops |

**Translation:** Claude is the architect, the reviewer, the conversation partner. Codex is the executor for parallel-batch, shell-heavy, token-volume, and long-autonomous work.

---

## 2. The unlock — `codex-plugin-cc`

OpenAI released the **official Codex plugin for Claude Code** on March 30, 2026. One slash command inside any Claude Code session runs a Codex review of the current diff/code. Two modes:

- **Normal review** — same quality as `/review` inside Codex directly
- **Adversarial review** — pressure-tests assumptions, tradeoffs, failure modes; questions whether a different approach would be safer/simpler

**Why this matters for Kairos:** the engine seam isn't only "Claude vs Codex" at dispatch time. *Within* a single Claude session, Codex becomes an **on-demand cross-model second opinion**. Different model architecture = independently arrived-at conclusions, which is the strongest possible review signal.

**Slots into Kairos at three levels:**

1. **In-session second opinion** — Claude Code calls `/codex-review` mid-session. Zero new infra. Install the plugin.
2. **Pre-commit / pre-push automated review** — extend the existing `pre-push-check.sh` Stop hook to also run a Codex review via plugin; surface findings as advisories.
3. **Plan step type: "ship + review"** — Phase 4 Plan threads gain a step type that dispatches a Claude session for implementation, then automatically triggers Codex adversarial review before marking step done.

---

## 3. Routing matrix — task class → engine

| Task class | Primary engine | Why | Where in Kairos build |
|---|---|---|---|
| **Voice conversation** | Claude Max | Conversation quality + ecosystem ergonomics | Phase 7 |
| **Daily briefing / advisory generation** | Claude Max | Nuance + tone + 1M context for cross-Dominion synthesis | Phase 4 (Briefer) |
| **Cross-Dominion plan synthesis** | Claude Max | Architectural reasoning across many projects | Phase 4 |
| **High-stakes code review / repo refactor** | Claude Max + Codex adversarial review | Two-engine verification | Phase 3 + plugin |
| **Frontend / UX implementation** | Claude Max | Codex weaker on frontend | Phase 3 |
| **Long-running `/goal` execution** | Claude Max for first run, Codex for re-runs | Claude better in extended sessions; Codex cheaper on retries | Phase 3 + 10 |
| **Shell-heavy ops** (deploy scripts, worker setup, MCP config) | **Codex** | Terminal-Bench dominance | Phase 3 (worker host setup itself), Phase 5 (channel adapters) |
| **Batch operations** (multi-repo audit, label cleanup, bulk lint) | **Codex `spawn_agents_on_csv`** | Native parallel fan-out | Phase 9 + ad-hoc |
| **Trophy → memory theme rollup** | **Codex (subagent fan-out)** | High-volume token-cheap clustering | Phase 9 |
| **Codebase exploration / mapping** | **Codex `pr_explorer` subagent** | Built-in parallel exploration with structured reports | Phase 1 *(use it to map Aeon codebase before changes)* |
| **PR review pipeline** (multi-perspective parallel) | **Codex subagents** (security, quality, bugs, race conditions, tests, maintainability all in parallel) | Built-in multi-agent review | Phase 4 + via plugin |
| **Routine PR scaffolding / lint fixes** | **Codex + company AI backend** | Volume work, cheapest path | Ad-hoc + Phase 10 |
| **Monitor loops (board stalls, application health)** | **Codex / company AI** | Token-cheap polling | Phase 4 (Monitor) |
| **Computer-use / browser screenshot triage** | **Codex Desktop** | Has computer-use built-in | Phase 5 (channel adapters) |
| **Sensitive code touching IP / private data** | **Company AI only** (forbidden engines: claude, codex) | Policy enforcement | Phase 2 router policy |
| **Burst overflow when subscriptions throttled** | **API fallback (BYOK)** | Last resort | After BYOK merge |

---

## 4. The three Codex slots in Kairos's architecture

### Slot A — Codex-as-Reviewer (inside Claude session)

- Install `codex-plugin-cc` globally in `~/.claude/`
- Add to `pre-push-check.sh` Stop hook: optionally run `/codex-review --adversarial` and surface findings
- Engine Router policy: "code review tasks" → flag for in-session Codex plugin call rather than separate spawn
- **No new schema needed.** Plugin handles everything.

### Slot B — Codex-as-Spawned-Engine (autonomous executor)

- Phase 3 spawn worker gains `engine: 'codex'` path → shells `codex exec --cd <repo> "<prompt>"`
- Codex session inherits AGENTS.md from repo (parallel to CLAUDE.md)
- Aeon MCP registered in Codex via `codex mcp add aeon <url> --bearer <token>`
- Hook-equivalent stream events → `/api/v1/sessions/<id>/events` (use Codex's `--json` output or pipe wrapper)
- Same `agent_sessions` table; `engine` column discriminates

### Slot C — Codex-as-Batch-Fanout (parallel processor)

- Use Codex's native `spawn_agents_on_csv` for list-shaped work:
  - Trophy rollup: CSV of vault items per project → fan-out theme-cluster → return structured memory drafts
  - Multi-repo audit: CSV of repo paths → fan-out lint/security/dep-check
  - Memory backfill (the existing `list_memories_needing_summary` flow): CSV of memory ids → fan-out aiTitle + execSummary generation
- Custom Codex subagent TOML configs live in `~/.codex/agents/` — define `aeon-rollup`, `aeon-backfill`, `aeon-audit`
- Engine Router policy "task_type: batch" → route to this slot

---

## 5. Cost arithmetic with Codex layered in

Refining the master plan cost map with token-efficiency data:

| Workload | Without Codex (Claude only) | With Codex slotted | Saving |
|---|---|---|---|
| 100 PR reviews/month | ~heavy Max quota | 80% on Codex (token-cheap) + Claude only for final synthesis | ~60-70% Max quota freed |
| Nightly trophy rollup across 12 projects | Not feasible on Max alone | Codex `spawn_agents_on_csv` via company-AI backend = free | 100% saving + scales linearly |
| Cross-codebase mapping when starting a new feature | Multiple Max sessions burning context | Codex `pr_explorer` returns structured map in one call | Both quota and elapsed time |
| 7+ hour `/goal` autonomous run | Possible but quota-heavy | Run on Codex; Claude reviews final diff via plugin | ~50% saving |
| Voice loop + advisories + briefings | Claude Max (correctly) | Claude Max (correctly) | No change — these *should* stay on Claude |

**Net effect:** Max quota is freed up for what only Claude does well (conversation, briefing, architectural reasoning, frontend, nuanced review), while Codex absorbs the high-volume token-cheap work that would otherwise force a tier upgrade.

---

## 6. AGENTS.md vs CLAUDE.md — symmetric but distinct

Codex reads `AGENTS.md` files at any directory level (root, package, subdirectory). Claude reads `CLAUDE.md` similarly. Two practical patterns:

- **Symmetric content:** if 95% of the guidance is identical (most cases), maintain `CLAUDE.md` as canonical and symlink or auto-generate `AGENTS.md` from it during repo setup
- **Engine-specific divergence:** for sections like "preferred tool flags" or "skip these hooks" that differ between engines, put engine-only sections in each file

**Recommendation for Aeon:** start with symlinked AGENTS.md → CLAUDE.md; revisit if engines diverge meaningfully.

---

## 7. The phases — concretely where Codex enters

Restating master plan phases with Codex injection points:

| Phase | Codex involvement |
|---|---|
| **0 (prep)** | Install `codex-plugin-cc` globally + add `codex-cli` to PATH on worker host + set up company-AI backend via `OPENAI_BASE_URL` |
| **1 — Dominion Body** | Use Codex `pr_explorer` to map current Aeon codebase before schema work begins (one-shot reconnaissance) |
| **2 — Engine Router** | Codex enters as one of 4 routable engines in the policy seed set |
| **3 — Spawn primitive** | Spawn worker supports `engine: 'codex'` from day one; AGENTS.md generated; Codex MCP registration scripted |
| **4 — Plans + Advisories** | New plan step type "ship + adversarial-review" auto-dispatches Codex review after Claude implementation |
| **5 — Channels** | Use Codex Desktop computer-use for inbound Teams screenshot triage (mobile QA bugs that arrive as images) |
| **6 — Graph edit** | Mostly Claude (frontend) |
| **7 — Voice** | Pure Claude (conversation quality) |
| **8 — Model-of-you** | Mostly Claude (nuance) |
| **9 — Trophy rollup** | **Codex `spawn_agents_on_csv` is the engine here**; company-AI backend = free unlimited rollups |
| **10 — Codex parity + tuning** | Router rewritten with real burn + success data; A2A adopted if 3+ specialised operators run concurrently |

---

## 8. Critical "do this first" sequence

Before any phase work begins:

1. **Install `codex-plugin-cc`** in `~/.claude/`: validate it works in a non-trivial diff (10 min)
2. **Install `codex` CLI** on dev box + register Aeon MCP via `codex mcp add aeon <url> <bearer>`
3. **Configure company AI as Codex backend:** `export OPENAI_BASE_URL=<company-ai-endpoint>` + auth — validate Codex runs against it
4. **Generate `AGENTS.md` ↔ `CLAUDE.md` symlink** in this repo + 3 other active repos
5. **Run a real test:** spin up a Claude Code session in this repo, call `/codex-review` on the current Kairos changes, compare to current `inferno-warden` agent output. Decide whether Codex review supplements or replaces inferno-warden for this codebase.

That's a 2-3 hour validation that de-risks all later Codex assumptions in the plan.

---

## 9. The asymmetric bet

Most teams running multi-agent setups treat Claude and Codex as competing primary engines and pick one. The actual winning move — confirmed across this research — is **Claude as primary architect + companion**, **Codex as parallel batch + token-cheap executor + adversarial reviewer**. They complement on opposite ends of the same workflow:

- Claude *opens* the work (planning, architecture, design)
- Claude *executes* the work (implementation, voice, briefing)
- Codex *batches* the work (rollups, audits, exploration)
- Codex *challenges* the work (adversarial review)
- Claude *closes* the work (final synthesis, commit, advisory)

Engine Router enforces this division. Neither model is wasted on tasks the other does better. Total cost stays flat while throughput multiplies.

---

## 10. Forward signals to watch

- **GitHub Agent HQ** (Feb 2026) — platform-level cross-model integration: multiple agents on same issue, compare results. Worth integrating once issue-tracking moves into a system that supports it
- **A2A protocol adoption** by both Anthropic and OpenAI — if standardised, replaces ad-hoc inter-engine glue
- **Codex Desktop computer-use maturity** — when stable enough, enables Kairos to dispatch GUI-driven tasks (Figma exports, browser QA flows)
- **Claude Code subagents** — currently manual; if Anthropic ships native parallel fan-out, the Slot C use case rebalances toward Claude

---

## Appendix — Sources

- [Claude Code vs Codex CLI 2026: Which Terminal AI Wins (NxCode)](https://www.nxcode.io/resources/news/claude-code-vs-codex-cli-terminal-coding-comparison-2026)
- [Codex vs Claude Code May 2026 Benchmarks (Morphllm)](https://www.morphllm.com/comparisons/codex-vs-claude-code)
- [Claude Code vs Codex 2026: Honest Verdict (Totalum)](https://www.totalum.app/blog/claude-code-vs-codex-2026)
- [Codex CLI vs Claude Code 2026: Architecture & Pricing](https://blakecrosley.com/blog/codex-vs-claude-code-2026)
- [Codex Subagents — OpenAI Developers](https://developers.openai.com/codex/subagents)
- [OpenAI Codex Subagents GA: Multi-Agent Parallel Coding (Sean Kim)](https://blog.imseankim.com/openai-codex-subagents-ga-multi-agent-parallel-coding-claude-code-comparison/)
- [Running Multiple Codex Agent Instances: Parallel Orchestration](https://codex.danielvaughan.com/2026/04/18/running-multiple-codex-agents-parallel-orchestration/)
- [The Codex CLI Customisation Stack (AGENTS.md + Skills + MCP)](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system/)
- [VS Code Multi-Agent Guide: Claude + Codex + Copilot Setup](https://www.morphllm.com/vscode-multi-agent)
- [Multi-Agent Orchestration: Claude, Codex, Copilot in Parallel (Scopir)](https://scopir.com/posts/multi-agent-orchestration-parallel-coding-2026/)
- [Automating Claude Code × Codex Review Loop (SmartScope)](https://smartscope.blog/en/blog/claude-code-codex-review-loop-automation-2026/)
- [OpenAI codex-plugin-cc GitHub Repo](https://github.com/openai/codex-plugin-cc)
- [Introducing Codex Plugin for Claude Code (OpenAI Community)](https://community.openai.com/t/introducing-codex-plugin-for-claude-code/1378186)
- [Codex Plugin for Claude Code: Cross-Provider AI Review (MindStudio)](https://www.mindstudio.ai/blog/openai-codex-plugin-claude-code-cross-provider-review)
- [Claude Review Loop Plugin (Hamel Smu — GitHub)](https://github.com/hamelsmu/claude-review-loop)
- [GPT-5.5 Review 2026 vs Claude Opus 4.7 (SSNTPL)](https://ssntpl.com/gpt-5-5-review-2026-benchmarks-and-pricing/)
- [Codex GPT-5.4 vs Claude Code Opus 4.6: Why I Use Both (Chandler Nguyen)](https://chandlernguyen.com/blog/2026/03/13/codex-gpt-5-4-vs-claude-code-opus-4-6-dual-wielding-ai-coding-tools/)
- [GPT-5.5 vs Claude Opus 4.7: Real-World Coding Performance (MindStudio)](https://www.mindstudio.ai/blog/gpt-55-vs-claude-opus-47-coding-comparison)
- [OpenAI Codex Desktop: Computer Use, Subagents, 90+ Plugins](https://letsdatascience.com/blog/openai-rebuilt-codex-into-a-claude-code-killer-it-now-runs-your-mac-while-youre-)
- [Code Review — Claude Code Docs](https://code.claude.com/docs/en/code-review)
