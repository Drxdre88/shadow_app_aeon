@echo off
REM Copy this file to runner.env.bat (gitignored) and fill in the values.

REM The aeon_k1_ API key this runner uses to claim missions. Generate one in
REM Aeon (Settings -> API keys). The runner only ever claims missions created
REM by this key's user.
set KAIROS_AEON_API_KEY=

REM Where Aeon lives from this machine's point of view.
REM Local dev:  http://localhost:3000     Production: your deployed URL.
set AEON_BASE_URL=

REM Optional worker controls (defaults shown):
REM set KAIROS_MODE=poll
REM set KAIROS_WORKER_PORT=8790
REM set KAIROS_POLL_INTERVAL_MS=15000
REM Missions run in disposable worktrees under KAIROS_WORKTREE_ROOT (default ~/.aeon/worktrees)
set KAIROS_MAX_CONCURRENT=4
REM Put the worktree root under a folder the Copilot CLI already trusts (trust is
REM inherited from the parent): an untrusted worktree loads no CLAUDE.md/AGENTS.md
REM and no repo skills, so the mission runs blind to the repo's own rules.
REM set KAIROS_WORKTREE_ROOT=D:/aeon-worktrees
REM Optional explicit Copilot mission tier. Without these lines the runner uses
REM the shared model registry default (claude-opus-5.5 at high effort) and
REM always passes a model, because Copilot's own default is an older Sonnet.
REM Effort and context are passed on argv because the CLI does not restore
REM contextTier from settings.json at startup.
REM   KAIROS_COPILOT_EFFORT:  none | minimal | low | medium | high | xhigh | max
REM   KAIROS_COPILOT_CONTEXT: default | long_context
REM set KAIROS_COPILOT_DEFAULT_MODEL=claude-opus-5.5
REM set KAIROS_COPILOT_EFFORT=high
REM set KAIROS_COPILOT_CONTEXT=long_context
REM Claude Code and Codex defaults also come from the registry
REM (claude-opus-5-5 / gpt-6.1-sol, high effort). Overrides:
REM set KAIROS_CLAUDE_DEFAULT_MODEL=claude-opus-5-5
REM set KAIROS_CLAUDE_EFFORT=high
REM set KAIROS_CODEX_DEFAULT_MODEL=gpt-6.1-sol
REM set KAIROS_CODEX_EFFORT=high
