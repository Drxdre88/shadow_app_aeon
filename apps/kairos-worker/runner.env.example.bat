@echo off
REM Copy this file to runner.env.bat (gitignored) and fill in the values.

REM The aeon_k1_ API key this runner uses to claim missions. Generate one in
REM Aeon (Settings -> API keys). The runner only ever claims missions created
REM by this key's user.
set KAIROS_AEON_API_KEY=

REM Where Aeon lives from this machine's point of view.
REM Local dev:  http://localhost:3000     Production: your deployed URL.
set AEON_BASE_URL=

REM Optional overrides (defaults shown):
REM set KAIROS_MODE=poll
REM set KAIROS_WORKER_PORT=8790
REM set KAIROS_POLL_INTERVAL_MS=15000
REM set KAIROS_MAX_CONCURRENT=1
REM set KAIROS_COPILOT_DEFAULT_MODEL=claude-sonnet-5
